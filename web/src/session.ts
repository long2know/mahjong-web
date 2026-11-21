import { appPath } from "./paths";
import { api, atLeast, parseServerMessage } from "./protocol";
import type { Ack, Action, ClientMessage, Command, Guest, Lease, Revisions, Snapshot } from "./protocol";

export type Connection = "connecting" | "syncing" | "online" | "offline" | "taken-over" | "unsupported";

const errors: Record<string, string> = {
  invalid_request: "Check the entered details and try again.",
  not_authenticated: "We couldn’t verify your guest session. Reload the page to try again.",
  forbidden: "This action isn’t available to your seat.",
  room_not_found: "That table or invitation is no longer available.",
  room_full: "That table just filled up. Try another one.",
  already_seated: "You already have a seat. Resume it before joining another table.",
  invalid_state: "The table has moved on. Review the current state and try again.",
  not_ready: "Wait until all four seats are filled and ready.",
  stale_room: "The room changed while you were acting. Checking the latest state.",
  stale_window: "That decision window has closed. Checking the latest state.",
  illegal_option: "That tile or action isn’t available in the current window.",
  paused: "This table is paused.",
  request_conflict: "A conflicting duplicate request was ignored. The table wasn’t changed by it.",
  request_expired: "An earlier request expired. Check the current table before choosing again.",
  rate_limited: "You’re sending messages too quickly. Wait a few seconds and try again.",
  busy: "The table is temporarily busy. Please try again.",
  unsupported_version: "This client and server use different protocol versions. Reload to check for an update.",
};

export function errorMessage(code: string): string {
  return errors[code] ?? "The server couldn’t complete that request. Please try again.";
}

interface Hooks {
  change: (event?: { snapshot: true; effects: boolean }) => void;
  notice: (message: string) => void;
  committed: (command: Command) => void;
  guestRefresh: (guest: Guest) => void;
}

interface Intent {
  message: Command;
  expiresAt: number;
  reserveOnLeave: boolean;
  deliveries: number;
}

type SnapshotExpectation = { roomId: string; revisions: Revisions | null };

function requestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const parts = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${parts.slice(0, 8)}-${parts.slice(8, 12)}-${parts.slice(12, 16)}-${parts.slice(16, 20)}-${parts.slice(20)}`;
}

function expectation(ack: Ack): SnapshotExpectation | null {
  return ack.roomId !== null && ack.roomRevision !== null && ack.gameRevision !== null
    ? { roomId: ack.roomId, revisions: { roomRevision: ack.roomRevision, gameRevision: ack.gameRevision } }
    : null;
}

export class TableSession {
  status: Connection = "connecting";
  snapshot: Snapshot | null = null;
  savedRoomId: string | null = null;
  private socket: WebSocket | null = null;
  private roomId: string | null = null;
  private lease: Lease | null = null;
  private intent: Intent | null = null;
  private sync: { id: string; roomId: string; ack: SnapshotExpectation | null } | null = null;
  private expected: SnapshotExpectation | null = null;
  private retryCount = 0;
  private retryTimer = 0;
  private leaseTimer = 0;
  private ackTimer = 0;
  private epoch = Date.now() - performance.now();

  constructor(private readonly hooks: Hooks) {
    window.addEventListener("online", () => {
      if (this.status === "offline") this.retry();
    });
  }

  get now(): number { return this.epoch + performance.now(); }

  get available(): boolean {
    return this.status === "online" && !this.intent && !this.expected &&
      !!this.lease && Date.parse(this.lease.expiresAtUtc) > this.now;
  }

  start(guest: Guest): void {
    this.savedRoomId = this.roomId = guest.resumeRoomId;
    this.connect();
  }

  retry(): void {
    if (this.status === "unsupported" || this.socket) return;
    if (this.status === "taken-over") this.roomId = this.savedRoomId;
    clearTimeout(this.retryTimer);
    this.connect();
  }

  resume(): void {
    if (!this.available || !this.savedRoomId || this.snapshot) return;
    this.requestSync(this.savedRoomId);
  }

  send(action: Action): boolean {
    if (!this.available || !this.lease) return false;
    if (action.op === "choose") {
      const state = this.snapshot;
      const window = state?.game?.window;
      if (!state || state.room.paused || !window?.deadlineUtc ||
        this.now >= Date.parse(window.deadlineUtc) ||
        action.payload.roomId !== state.roomId || action.payload.windowId !== window.windowId ||
        action.payload.anchorGameRevision !== window.anchorGameRevision ||
        !state.self.legalOptions.some(option => option.optionId === action.payload.optionId)) return false;
    }
    this.intent = {
      message: { ...action, v: 1, type: "command", requestId: requestId(), lease: this.lease.lease },
      expiresAt: Date.parse(this.lease.expiresAtUtc),
      reserveOnLeave: action.op === "leaveRoom" &&
        (this.snapshot?.room.status === "playing" || this.snapshot?.room.status === "betweenHands"),
      deliveries: 0,
    };
    this.sendIntent();
    this.hooks.change();
    return true;
  }

  private connect(): void {
    if (this.socket) return;
    this.status = this.roomId ? "syncing" : "connecting";
    this.hooks.change();
    const socket = new WebSocket(appPath + "ws");
    this.socket = socket;
    this.waitForResponse(() => this.reconnectSocket());
    socket.addEventListener("message", event => {
      if (this.socket !== socket) return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "lease": {
          const first = this.lease === null;
          this.lease = message;
          this.setClock(message.serverTimeUtc);
          this.scheduleRenewal();
          if (first) void this.attach(socket);
          else this.hooks.change();
          break;
        }
        case "ack": this.receiveAck(message); break;
        case "snapshot": this.receiveSnapshot(message); break;
        case "error":
          if (message.error.code === "room_not_found") {
            this.clearRoom();
            if (this.lease) this.online();
          }
          if (message.error.code === "unsupported_version") this.status = "unsupported";
          this.hooks.notice(errorMessage(message.error.code));
          this.hooks.change();
          break;
      }
    });
    socket.addEventListener("close", event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lease = null;
      this.sync = null;
      this.expected = null;
      clearTimeout(this.ackTimer);
      clearTimeout(this.leaseTimer);
      if (event.code === 4001) {
        this.intent = null;
        this.status = "taken-over";
        this.hooks.notice("This seat is open in another tab. This tab will not reconnect on its own.");
      } else if (event.code === 1002 || this.status === "unsupported") {
        this.intent = null;
        this.status = "unsupported";
        this.hooks.notice(errorMessage("unsupported_version"));
      } else {
        this.status = "offline";
        const delay = Math.min(8000, 400 * 2 ** Math.min(this.retryCount++, 5)) + Math.random() * 200;
        this.retryTimer = window.setTimeout(() => this.connect(), delay);
      }
      this.hooks.change();
    });
  }

  private async attach(socket: WebSocket): Promise<void> {
    clearTimeout(this.ackTimer);
    if (!this.roomId && (this.intent?.message.op === "createRoom" || this.intent?.message.op === "joinRoom")) {
      try {
        const guest = await api.guest();
        if (this.socket !== socket) return;
        this.savedRoomId = this.roomId = guest.resumeRoomId;
        this.hooks.guestRefresh(guest);
      } catch {
        if (this.socket !== socket) return;
        this.reconnectSocket();
        return;
      }
    }
    if (this.socket !== socket) return;
    if (this.roomId) this.requestSync(this.roomId);
    else this.online();
  }

  private online(): void {
    clearTimeout(this.ackTimer);
    this.status = "online";
    this.retryCount = 0;
    if (this.intent) {
      if (this.intent.expiresAt > this.now) this.sendIntent();
      else {
        this.intent = null;
        this.hooks.notice(errorMessage("request_expired"));
      }
    }
    this.hooks.change();
  }

  private setClock(utc: string): void {
    this.epoch = Date.parse(utc) - performance.now();
  }

  private requestSync(roomId: string): void {
    this.roomId = roomId;
    this.expected = null;
    this.sync = { id: requestId(), roomId, ack: null };
    this.status = "syncing";
    this.write({ v: 1, type: "sync", requestId: this.sync.id, roomId });
    this.waitForResponse(() => this.reconnectSocket());
    this.hooks.change();
  }

  private receiveSnapshot(state: Snapshot): void {
    if (state.roomId !== this.roomId || (this.snapshot?.roomId === state.roomId && !atLeast(state, this.snapshot))) return;
    const sync = this.sync;
    if (sync && (!sync.ack || (sync.ack.revisions && !atLeast(state, sync.ack.revisions)))) return;
    const effects = this.status === "online" && this.snapshot?.roomId === state.roomId &&
      state.gameRevision === this.snapshot.gameRevision + 1;
    this.setClock(state.serverTimeUtc);
    this.snapshot = state;
    this.savedRoomId = state.roomId;
    if (this.expected?.roomId === state.roomId && (!this.expected.revisions || atLeast(state, this.expected.revisions))) {
      this.expected = null;
      clearTimeout(this.ackTimer);
    }
    if (sync) {
      this.sync = null;
      this.online();
    }
    this.hooks.change({ snapshot: true, effects });
  }

  private receiveAck(ack: Ack): void {
    if (this.sync?.id === ack.requestId) {
      if (ack.status === "ok") {
        this.sync.ack = expectation(ack) ?? { roomId: this.sync.roomId, revisions: null };
      } else {
        const code = ack.error?.code ?? "unavailable";
        this.sync = null;
        if (code === "room_not_found" || code === "forbidden") {
          this.clearRoom();
          if (this.intent?.message.op !== "leaveRoom") this.hooks.notice(errorMessage(code));
          this.online();
        } else {
          this.hooks.notice(errorMessage(code));
          this.reconnectSocket();
        }
      }
      return;
    }

    const intent = this.intent;
    if (!intent || intent.message.requestId !== ack.requestId) return;
    this.intent = null;
    clearTimeout(this.ackTimer);
    if (ack.status === "error") {
      const code = ack.error?.code ?? "unavailable";
      this.hooks.notice(errorMessage(code));
      const next = expectation(ack);
      if (next && this.roomId === next.roomId && (!this.snapshot || !atLeast(this.snapshot, next.revisions!))) {
        this.waitForSnapshot(next, 340);
      } else if (this.roomId && ["stale_room", "stale_window", "illegal_option", "paused", "request_expired", "not_ready"].includes(code)) {
        this.waitForSnapshot({ roomId: this.roomId, revisions: null }, 340);
      } else if (code === "already_seated" && !this.roomId) {
        void this.checkSavedMembership();
      }
      this.hooks.change();
      return;
    }
    if (intent.message.op === "leaveRoom") {
      const reserve = intent.reserveOnLeave ? intent.message.payload.roomId : null;
      this.clearRoom();
      this.savedRoomId = reserve;
      this.hooks.committed(intent.message);
      this.hooks.change();
      if (reserve && intent.deliveries > 1) this.reconnectSocket();
      return;
    }
    const next = expectation(ack);
    if (next) {
      this.roomId = next.roomId;
      if (this.snapshot?.roomId !== next.roomId || !atLeast(this.snapshot, next.revisions!)) {
        this.waitForSnapshot(next);
      }
    }
    this.hooks.committed(intent.message);
    this.hooks.change();
  }

  private async checkSavedMembership(): Promise<void> {
    try {
      const guest = await api.guest();
      if (!this.roomId) this.savedRoomId = guest.resumeRoomId;
      this.hooks.guestRefresh(guest);
      this.hooks.change();
    } catch { /* The seat can still be rediscovered by reloading. */ }
  }

  private clearRoom(): void {
    this.roomId = null;
    this.savedRoomId = null;
    this.snapshot = null;
    this.sync = null;
    this.expected = null;
    clearTimeout(this.ackTimer);
  }

  private waitForSnapshot(next: SnapshotExpectation, delay = 1000): void {
    this.expected = next;
    this.waitForResponse(() => this.requestSync(next.roomId), delay);
  }

  private sendIntent(): void {
    if (!this.intent) return;
    this.intent.deliveries++;
    this.write(this.intent.message);
    this.waitForResponse(() => this.reconnectSocket());
  }

  private scheduleRenewal(): void {
    if (!this.lease) return;
    clearTimeout(this.leaseTimer);
    const delay = Math.max(1000, Date.parse(this.lease.expiresAtUtc) - this.now - 60000);
    this.leaseTimer = window.setTimeout(() => {
      this.write({ v: 1, type: "renewLease" });
      this.leaseTimer = window.setTimeout(() => this.reconnectSocket(), 5000);
    }, delay);
  }

  private waitForResponse(handler: () => void, delay = 6000): void {
    clearTimeout(this.ackTimer);
    this.ackTimer = window.setTimeout(handler, delay);
  }

  private write(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private reconnectSocket(): void {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(4000, "resync");
  }
}

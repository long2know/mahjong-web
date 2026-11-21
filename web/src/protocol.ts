export type Seat = 0 | 1 | 2 | 3;
export type Suit = "b" | "c" | "d";
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Face = `${Suit}${Rank}`;
export type Visibility = "public" | "invite";
export type MatchHands = 1 | 4;
export type RoomStatus = "waiting" | "playing" | "betweenHands" | "complete";
export type OptionKind = "discard" | "draw" | "chi" | "peng" | "gang" | "bu" | "hu" | "pass" | "reveal";

export interface Preferences {
  sound: boolean;
  music: boolean;
  volume: number;
  reducedMotion: boolean;
}

export interface Guest {
  displayName: string;
  resumeRoomId: string | null;
  preferences: Preferences;
}

export interface PublicRoom {
  roomId: string;
  occupiedSeats: number;
  matchHands: MatchHands;
}

export interface RoomSeat {
  seat: Seat;
  kind: "open" | "human" | "bot";
  displayName: string | null;
  ready: boolean;
  connected: boolean;
}

export interface ChatMessage {
  messageId: string;
  seat: Seat;
  displayName: string;
  text: string;
  sentAtUtc: string;
}

export interface Room {
  visibility: Visibility;
  status: RoomStatus;
  hostSeat: Seat;
  matchHands: MatchHands;
  paused: boolean;
  autoResumeAtUtc: string | null;
  rulesVersion: "changsha-v1";
  seats: RoomSeat[];
  chat: ChatMessage[];
}

export interface Tile {
  tileId: string;
  face: Face;
}

export interface Option {
  optionId: string;
  kind: OptionKind;
  tileIds: string[];
  faces: Face[];
}

export interface Self {
  seat: Seat;
  inviteCode: string | null;
  hand: Tile[];
  drawnTileId: string | null;
  legalOptions: Option[];
}

export interface Meld {
  kind: "chi" | "peng" | "gang" | "bu";
  method?: "open" | "concealed" | "added" | null;
  fromSeat: Seat | null;
  tiles: (Face | null)[];
}

export interface GameSeat {
  seat: Seat;
  concealedCount: number;
  discards: Face[];
  melds: Meld[];
  revealedTiles: Face[];
  total: number;
}

export interface DecisionWindow {
  windowId: string;
  anchorGameRevision: number;
  reason: "turn" | "opening" | "discard" | "kong" | "lastTile";
  deadlineUtc: string | null;
  trigger: { seat: Seat; faces: Face[] } | null;
}

export interface Settlement {
  reason: "win" | "draw";
  nextDealerSeat: Seat;
  sourceSeat: Seat | null;
  winners: {
    seat: Seat;
    winBy: "selfDraw" | "discard" | "robKong";
    winningTiles: Face[];
    winningHand?: { concealedTiles: Face[]; melds: (Omit<Meld, "tiles"> & { tiles: Face[] })[] };
    patterns: { code: string; label: string; points: number }[];
  }[];
  birds: Face[];
  seatResults: { seat: Seat; delta: number; total: number }[];
  transfers?: { fromSeat: Seat; toSeat: Seat; points: number; reason: string }[];
}

export interface Game {
  handNumber: number;
  dealerSeat: Seat;
  phase: "turn" | "claim" | "settled";
  turnSeat: Seat | null;
  kongRoll?: { seat: Seat; dice: [number, number]; lowerDie: number } | null;
  wallCount: number;
  seats: GameSeat[];
  window: DecisionWindow | null;
  settlement: Settlement | null;
}

interface Versioned { v: 1 }
export interface Revisions {
  roomRevision: number;
  gameRevision: number;
}

export interface Snapshot extends Versioned, Revisions {
  type: "snapshot";
  roomId: string;
  serverTimeUtc: string;
  room: Room;
  game: Game | null;
  self: Self;
}

interface RoomRevision {
  roomId: string;
  expectedRoomRevision: number;
}

export interface Payloads {
  createRoom: { visibility: Visibility; matchHands: MatchHands; fillBots?: boolean };
  joinRoom: { roomId: string; inviteCode?: never } | { inviteCode: string; roomId?: never };
  setReady: RoomRevision & { ready: boolean };
  setBot: RoomRevision & { seat: Seat; enabled: boolean };
  start: RoomRevision;
  setPaused: RoomRevision & { paused: boolean };
  choose: { roomId: string; windowId: string; anchorGameRevision: number; optionId: string };
  nextHand: RoomRevision;
  leaveRoom: RoomRevision;
  rematch: RoomRevision;
  chat: { roomId: string; text: string };
}

export type Operation = keyof Payloads;
export type Action = { [K in Operation]: { op: K; payload: Payloads[K] } }[Operation];
export type Command = Versioned & { type: "command"; requestId: string; lease: string } & Action;
export type ClientMessage = Command | (Versioned & (
  { type: "renewLease" } | { type: "sync"; requestId: string; roomId: string }
));

export interface Ack extends Versioned {
  type: "ack";
  requestId: string;
  status: "ok" | "error";
  error: { code: string } | null;
  roomId: string | null;
  roomRevision: number | null;
  gameRevision: number | null;
}

export interface Lease extends Versioned {
  type: "lease";
  lease: string;
  expiresAtUtc: string;
  serverTimeUtc: string;
}

export type ServerMessage = Snapshot | Ack | Lease | (Versioned & { type: "error"; error: { code: string } });

export function atLeast(a: Revisions, b: Revisions): boolean {
  return a.roomRevision >= b.roomRevision && a.gameRevision >= b.gameRevision;
}

export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data);
    if (!value || value.v !== 1) return null;
    const date = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
    const revision = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;
    switch (value.type) {
      case "lease":
        if (typeof value.lease === "string" && date(value.expiresAtUtc) && date(value.serverTimeUtc)) return value;
        break;
      case "ack":
        if (typeof value.requestId === "string" && ["ok", "error"].includes(value.status) &&
          (value.error === null || typeof value.error?.code === "string") &&
          (value.roomId === null || typeof value.roomId === "string") &&
          (value.roomRevision === null || revision(value.roomRevision)) &&
          (value.gameRevision === null || revision(value.gameRevision))) return value;
        break;
      case "snapshot":
        if (typeof value.roomId === "string" && revision(value.roomRevision) && revision(value.gameRevision) &&
          date(value.serverTimeUtc) && value.room?.seats?.length === 4 &&
          Array.isArray(value.self?.hand) && Array.isArray(value.self?.legalOptions) &&
          (value.game === null || value.game?.seats?.length === 4)) return value;
        break;
      case "error":
        if (typeof value.error?.code === "string") return value;
        break;
    }
  } catch {
    return null;
  }
  return null;
}

export const defaultPreferences: Preferences = { sound: true, music: false, volume: 0.7, reducedMotion: false };

export class HttpError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function json<T>(path: string, method: "POST" | "PATCH" | "GET", data?: object): Promise<T> {
  const response = await fetch(path, {
    method, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8000),
    ...(data ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new HttpError(result?.error?.code ?? "unavailable");
  }
  return response.json();
}

export const api = {
  guest: () => json<Guest>("/api/guest", "POST", {}),
  profile: (update: { displayName?: string; preferences?: Preferences }) =>
    json<Guest>("/api/profile", "PATCH", update),
  rooms: () => json<{ rooms: PublicRoom[] }>("/api/rooms", "GET"),
};

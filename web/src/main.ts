import "./styles.css";
import { LanternAudio } from "./audio";
import { Modal } from "./dialog";
import { button, el, icon, text } from "./dom";
import { appPath } from "./paths";
import { api, HttpError } from "./protocol";
import type { Action, Command, Guest, Preferences, Snapshot } from "./protocol";
import { ChatPanel, HomeScreen, WaitingRoom, field, iconButton, resultsContent, rulesContent, submit, toggle, nameField } from "./screens";
import { errorMessage, TableSession } from "./session";
import type { Connection } from "./session";
import { TableView } from "./table";
import type { TableCue } from "./table";

const connectionText: Record<Connection, string> = {
  connecting: "Connecting", syncing: "Syncing", online: "Online", offline: "Offline",
  "taken-over": "Other tab", unsupported: "Update needed",
};

const nonDiscard = /[\u0000-\u001f\u007f-\u009f]/u;

class LanternTable {
  private readonly root = el("div", "shell");
  private readonly main = el("main");
  private readonly connectionLabel = el("span");
  private readonly connection = el("span", "connection", el("i"), this.connectionLabel);
  private readonly noticeText = el("p");
  private readonly retryButton = button("Reconnect now", "btn secondary", () => this.retry());
  private readonly dismissButton = iconButton("close", "Dismiss message", () => this.showNotice(""));
  private readonly notice = el("div", "notice", this.noticeText, el("div", "notice-actions", this.retryButton, this.dismissButton));
  private readonly audio = new LanternAudio();
  private readonly modal = new Modal(() => this.modalClosed());
  private readonly chatButton = iconButton("chat", "Table chat", () => this.openChat());
  private readonly settingsButton = iconButton("settings", "Settings", () => this.openSettings());
  private readonly chat = new ChatPanel(message => {
    const state = this.session.snapshot;
    if (state) this.command({ op: "chat", payload: { roomId: state.roomId, text: message } });
  });
  private readonly home = new HomeScreen({
    quick: () => void this.enter({ op: "createRoom", payload: { visibility: "invite", matchHands: 1, fillBots: true } }),
    create: () => this.openCreate(),
    resume: () => this.session.resume(),
    join: inviteCode => void this.enter({ op: "joinRoom", payload: { inviteCode } }),
    publicJoin: roomId => void this.enter({ op: "joinRoom", payload: { roomId } }),
    refresh: () => void this.refresh(),
  });
  private readonly waiting = new WaitingRoom({
    ready: ready => { const room = this.bound(); if (room) this.command({ op: "setReady", payload: { ...room, ready } }); },
    bot: (seat, enabled) => { const room = this.bound(); if (room) this.command({ op: "setBot", payload: { ...room, seat, enabled } }); },
    start: () => { const room = this.bound(); if (room) this.command({ op: "start", payload: room }); },
    invite: () => this.openInvite(),
    leave: () => this.leave(),
  });
  private readonly table = new TableView({
    choose: option => {
      const state = this.session.snapshot;
      const window = state?.game?.window;
      if (state && window) this.command({
        op: "choose", payload: { roomId: state.roomId, windowId: window.windowId,
          anchorGameRevision: window.anchorGameRevision, optionId: option.optionId },
      });
    },
    selected: () => this.audio.play("select"),
    results: () => this.openResults(),
    motionStopped: () => this.finishResultReveal(),
    pause: () => {
      const room = this.bound();
      if (room) this.command({ op: "setPaused", payload: { ...room, paused: !this.session.snapshot?.room.paused } });
    },
  });
  private readonly session = new TableSession({
    change: event => this.render(event?.effects ?? false),
    notice: message => this.showNotice(message),
    committed: command => this.committed(command),
    guestRefresh: guest => this.setGuest(guest),
  });

  private guest: Guest | null = null;
  private booting = false;
  private bootFailed = false;
  private profileBusy = false;
  private refreshBusy = false;
  private scene: "home" | "waiting" | "play" | null = null;
  private previous: Snapshot | null = null;
  private connectionBefore: Connection = "connecting";
  private resultKey = "";
  private resultReveal = 0;
  private message = "";
  private overlayActions: HTMLButtonElement[] = [];

  constructor(mount: HTMLElement) {
    const brand = el("div", "brand", el("span", "brand-symbol", icon("lantern")),
      el("div", "", el("p", "brand-name", "Lantern Table"), el("p", "brand-kicker", "Changsha Mahjong")));
    const rulesButton = iconButton("book", "Changsha rules", () => this.modal.show("rules", "Changsha rules", rulesContent()));
    const header = el("header", "site-header", brand, el("div", "header-actions", this.connection, rulesButton, this.chatButton, this.settingsButton));
    this.connection.setAttribute("role", "status");
    this.noticeText.setAttribute("role", "status");
    this.root.append(header, this.notice, this.main, this.modal.root);
    this.main.tabIndex = -1;
    mount.append(this.root);
    window.setInterval(() => {
      if (this.session.snapshot?.game) this.table.tick(this.session.now);
    }, 140);
    window.setInterval(() => {
      if (!document.hidden && this.scene === "home" && this.session.status === "online") void this.refresh(false);
    }, 15000);
    void this.boot();
  }

  private async boot(): Promise<void> {
    if (this.booting) return;
    this.booting = true;
    this.bootFailed = false;
    this.render();
    try {
      const guest = await api.guest();
      this.setGuest(guest);
      this.session.start(guest);
      void this.refresh();
    } catch (error) {
      this.bootFailed = true;
      this.showNotice(error instanceof HttpError ? errorMessage(error.code) : "Couldn’t reach the table server. Check your connection and try again.");
    } finally {
      this.booting = false;
      this.render();
    }
  }

  private retry(): void {
    this.showNotice("");
    if (this.bootFailed) void this.boot();
    else this.session.retry();
  }

  private setGuest(guest: Guest): void {
    this.guest = guest;
    this.home.identity(guest);
    this.audio.configure(guest.preferences);
  }

  private async refresh(showLoading = true): Promise<void> {
    if (!this.guest || this.refreshBusy) return;
    this.refreshBusy = true;
    if (showLoading) this.home.rooms({ kind: "loading" });
    try {
      const result = await api.rooms();
      this.home.rooms({ kind: "ready", items: result.rooms });
    } catch {
      this.home.rooms({ kind: "error" });
    } finally {
      this.refreshBusy = false;
    }
  }

  private bound(): { roomId: string; expectedRoomRevision: number } | null {
    const state = this.session.snapshot;
    return state ? { roomId: state.roomId, expectedRoomRevision: state.roomRevision } : null;
  }

  private async enter(action: Action): Promise<void> {
    if (!this.session.available || !this.guest || this.profileBusy || this.session.savedRoomId) return;
    const name = this.home.name.value.trim() || this.guest.displayName;
    if (nonDiscard.test(name)) {
      this.showNotice("Use a display name without control characters.");
      return;
    }
    if (name !== this.guest.displayName) {
      this.profileBusy = true;
      this.render();
      try {
        this.setGuest(await api.profile({ displayName: name }));
      } catch (error) {
        this.showNotice(error instanceof HttpError ? errorMessage(error.code) : "Couldn’t save your display name. Please try again.");
        return;
      } finally {
        this.profileBusy = false;
        this.render();
      }
    }
    this.command(action);
  }

  private command(action: Action): void {
    if (!this.session.available) return;
    this.showNotice("");
    this.session.send(action);
  }

  private committed(command: Command): void {
    if (command.op === "chat") this.chat.committed(command.payload.text);
    if (command.op === "joinRoom" && command.payload.inviteCode) {
      this.home.consumedInvitation();
      if (new URLSearchParams(location.hash.slice(1)).has("invite")) {
        history.replaceState(history.state, "", location.pathname + location.search);
      }
    }
    if (command.op === "leaveRoom") {
      this.modal.close();
      this.chat.reset();
      void this.refresh();
    }
  }

  private leave(): void {
    const room = this.bound();
    if (room) this.command({ op: "leaveRoom", payload: room });
  }

  private showNotice(message: string): void {
    this.message = message;
    if (this.modal.root.open) this.modal.message(message);
    this.paintConnection();
  }

  private paintConnection(): void {
    const status = this.bootFailed ? "offline" : this.session.status;
    this.connection.dataset.status = status;
    text(this.connectionLabel, connectionText[status]);
    const passive = status === "offline" ? "Connection lost. Your seat is kept while we reconnect." :
      status === "taken-over" ? "This seat is open in another tab. This tab will not reconnect on its own." : "";
    const message = this.message || passive;
    this.retryButton.hidden = !this.bootFailed && status !== "offline" && status !== "taken-over";
    text(this.retryButton, status === "taken-over" ? "Use this tab" : this.bootFailed ? "Try again" : "Reconnect now");
    this.notice.hidden = !message;
    this.dismissButton.hidden = !this.message || status === "taken-over" || this.bootFailed;
    text(this.noticeText, message);
  }

  private render(effect = false): void {
    const state = this.session.snapshot;
    const available = this.session.available && !this.profileBusy;
    const scene = state?.room.status === "waiting" ? "waiting" : state?.game ? "play" : "home";
    const interrupted = this.connectionBefore === "online" && this.session.status !== "online" ||
      this.scene === "play" && scene !== "play";
    if (interrupted) {
      this.table.clearEffects();
      this.audio.clearEffects();
    }
    this.connectionBefore = this.session.status;
    this.paintConnection();
    this.chatButton.hidden = !state;
    this.settingsButton.disabled = !this.guest;
    this.home.controls(available, !!this.session.savedRoomId, !!this.guest,
      this.profileBusy ? "Saving your display name…" : this.booting ? "Opening a guest session…" :
        this.session.status === "syncing" && !state ? "Checking your saved seat…" : "");

    if (this.scene !== scene) {
      const initial = this.scene === null;
      this.scene = scene;
      this.main.replaceChildren(scene === "home" ? this.home.root : scene === "waiting" ? this.waiting.root : this.table.root);
      if (this.modal.kind === "create" || this.modal.kind === "results" || (scene === "home" && this.modal.kind === "chat")) {
        this.modal.close();
      }
      if (!initial && !this.modal.root.open) {
        this.main.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      if (scene === "home" && !initial) void this.refresh();
    }

    let cue: TableCue | undefined;
    if (state) {
      if (!this.previous || this.previous.roomId !== state.roomId) this.chat.reset();
      this.chat.update(state.room.chat ?? [], state.self.seat, available);
      if (scene === "waiting") this.waiting.update(state, available);
      // Remember the same-room waiting projection before the first live hand.
      if (state.game || scene === "waiting") cue = this.table.update(state, available, this.session.now, effect);
    }
    if (cue) this.audio.play(cue);
    this.overlayActions.forEach(control => { control.disabled = !available; });

    const settlement = state?.game?.settlement;
    const key = settlement ? `${state!.roomId}:${state!.game!.handNumber}:${state!.gameRevision}` : "";
    if (key !== this.resultKey) {
      this.cancelResultReveal();
      this.resultKey = key;
      if (key && !this.modal.root.open) {
        if ((cue === "win" || cue === "exhausted") && this.table.motionEnabled) {
          this.resultReveal = window.setTimeout(() => {
            this.resultReveal = 0;
            if (!this.modal.root.open) this.openResults();
          }, 540);
        } else this.openResults();
      }
      if (!key && this.modal.kind === "results") this.modal.close();
    } else if (this.resultReveal && (interrupted || !this.table.motionEnabled)) {
      this.finishResultReveal();
    }
    this.previous = state;
  }

  private cancelResultReveal(): void {
    clearTimeout(this.resultReveal);
    this.resultReveal = 0;
  }

  private finishResultReveal(): void {
    if (!this.resultReveal) return;
    this.cancelResultReveal();
    if (!this.modal.root.open) this.openResults();
  }

  private modalClosed(): void {
    this.overlayActions = [];
  }

  private openCreate(): void {
    if (!this.session.available || this.session.savedRoomId) return;
    const visibility = el("select", "", el("option", "", "Invite only"), el("option", "", "Public"));
    visibility.options[0].value = "invite";
    visibility.options[1].value = "public";
    const hands = el("select", "", el("option", "", "One hand"), el("option", "", "Four hands"));
    const bots = toggle("Fill the other three seats with bots", false);
    const create = submit("Create table");
    const form = el("form", "form", field("Who can join?", visibility), field("Match length", hands), bots.field,
      el("p", "note", "You can also add or remove bots from the waiting room."), el("div", "row-actions", create));
    form.addEventListener("submit", event => {
      event.preventDefault();
      void this.enter({ op: "createRoom", payload: {
        visibility: visibility.selectedIndex === 0 ? "invite" : "public", matchHands: hands.selectedIndex === 0 ? 1 : 4,
        fillBots: bots.input.checked,
      } });
    });
    this.overlayActions = [create];
    this.modal.show("create", "Create a table", form);
  }

  private openSettings(): void {
    if (!this.guest) return;
    const name = nameField(this.guest.displayName);
    name.required = true;
    const preferences = this.guest.preferences;
    const sound = toggle("Tile and turn sounds", preferences.sound);
    const music = toggle("Quiet table music", preferences.music);
    const motion = toggle("Reduce visual motion", preferences.reducedMotion);
    const volume = el("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = String(Math.round(preferences.volume * 100));
    const readout = el("span", "", `Volume · ${volume.value}%`);
    volume.addEventListener("input", () => text(readout, `Volume · ${volume.value}%`));
    const audioNote = el("p", "note", this.audio.note);
    const save = submit("Save settings");
    const actions = el("div", "row-actions", save);
    const state = this.session.snapshot;
    const reserve = state?.room.status === "playing" || state?.room.status === "betweenHands";
    const leave = button(reserve ? "Back to lobby" : "Leave table", "btn subtle", () => this.leave());
    if (state) {
      actions.append(leave);
      this.overlayActions = [leave];
    }
    const form = el("form", "form", field("Display name", name), sound.field, music.field,
      el("label", "field", readout, volume), audioNote, motion.field, actions);
    if (reserve) form.append(el("p", "note", "Your seat stays reserved. Timed decisions continue at the table."));
    form.addEventListener("submit", event => {
      event.preventDefault();
      const displayName = name.value.trim();
      if (!displayName || nonDiscard.test(displayName)) {
        this.modal.message("Enter a display name of 1–24 characters without controls.");
        name.focus();
        return;
      }
      if (this.profileBusy) return;
      const prefs: Preferences = { sound: sound.input.checked, music: music.input.checked,
        volume: Number(volume.value) / 100, reducedMotion: motion.input.checked };
      if (prefs.sound || prefs.music) void this.audio.unlock(true);
      void this.saveSettings(displayName, prefs, form, save, audioNote);
    });
    leave.disabled = !this.session.available;
    this.modal.show("settings", "Settings", form, this.settingsButton);
    void import("./fullscreen").then(module => module.addFullscreen(actions),
      () => actions.before(el("p", "note", "Full screen unavailable.")));
  }

  private async saveSettings(name: string, preferences: Preferences, form: HTMLElement, save: HTMLButtonElement, note: HTMLElement): Promise<void> {
    this.profileBusy = true;
    save.disabled = true;
    this.modal.message("");
    try {
      this.setGuest(await api.profile({ displayName: name, preferences }));
      if (form.isConnected) {
        this.modal.message("Settings saved.");
        text(note, this.audio.note);
      }
    } catch (error) {
      if (form.isConnected) this.modal.message(error instanceof HttpError ? errorMessage(error.code) : "Couldn’t save settings. Please try again.");
    } finally {
      this.profileBusy = false;
      save.disabled = false;
      this.render();
    }
  }

  private openChat(): void {
    if (!this.session.snapshot) return;
    this.modal.show("chat", "Table chat", this.chat.root, this.chatButton);
    this.render();
  }

  private openInvite(): void {
    const code = this.session.snapshot?.self.inviteCode;
    if (!code) return;
    const link = new URL(appPath, location.origin);
    link.hash = new URLSearchParams({ invite: code }).toString();
    const input = el("input");
    input.readOnly = true;
    input.value = link.href;
    const copy = iconButton("copy", "Copy invite link", () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(link.href);
          if (this.modal.kind === "invite") this.modal.message("Link copied.");
        } catch {
          if (this.modal.kind !== "invite") return;
          input.focus();
          input.select();
          this.modal.message("Link selected. Copy it to send your invitation.");
        }
      })();
    });
    const content = el("div", "form", el("p", "detail", "Share this link with friends you want to seat. It doesn’t contain your guest credentials."),
      el("div", "link-field", field("Invite link", input), copy));
    this.modal.show("invite", "Invite friends", content);
  }

  private openResults(): void {
    this.cancelResultReveal();
    const state = this.session.snapshot;
    if (!state?.game?.settlement) return;
    const complete = state.room.status === "complete";
    const controls: HTMLButtonElement[] = [];
    if (!complete) controls.push(button("Next hand", "btn primary", () => {
      const room = this.bound();
      if (room) this.command({ op: "nextHand", payload: room });
    }));
    if (complete && state.room.hostSeat === state.self.seat) controls.push(button("Rematch", "btn primary", () => {
      const room = this.bound();
      if (room) this.command({ op: "rematch", payload: room });
    }));
    if (complete) controls.push(button("Leave table", "btn subtle", () => this.leave()));
    this.overlayActions = controls;
    controls.forEach(control => { control.disabled = !this.session.available; });
    const content = resultsContent(state, controls);
    this.modal.show("results", complete ? "Match results" : "Hand results", content);
  }
}

new LanternTable(document.querySelector<HTMLElement>("#app")!);

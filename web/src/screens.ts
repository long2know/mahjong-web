import { button, el, icon, reconcile, text, winds } from "./dom";
import type { ChatMessage, Face, Guest, PublicRoom, RoomSeat, Seat, Snapshot } from "./protocol";
import { setMelds } from "./table";
import { tileLabel } from "./tile";

export function iconButton(name: Parameters<typeof icon>[0], label: string, run: () => void): HTMLButtonElement {
  const control = button("", "btn icon-btn", run);
  control.setAttribute("aria-label", label);
  control.title = label;
  control.append(icon(name));
  return control;
}

export function field(label: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  return el("label", "field", el("span", "", label), control);
}

export function toggle(label: string, checked: boolean): { field: HTMLLabelElement; input: HTMLInputElement } {
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  return { field: el("label", "check", input, el("span", "", label)), input };
}

export function submit(label: string, style = "btn primary"): HTMLButtonElement {
  const control = button(label, style);
  control.type = "submit";
  return control;
}

export function nameField(name = ""): HTMLInputElement {
  const input = el("input");
  input.maxLength = 24;
  input.placeholder = "Guest";
  input.value = name;
  input.setAttribute("autocomplete", "nickname");
  return input;
}

export function inviteCode(raw: string): string | null {
  let candidate = raw.trim();
  if (candidate.includes("#")) candidate = new URLSearchParams(candidate.split("#", 2)[1]).get("invite") ?? "";
  return /^[A-Za-z0-9_-]{16}$/.test(candidate) ? candidate : null;
}

function panelHeading(kicker: string, title: string, control?: HTMLElement): HTMLElement {
  return el("div", "panel-heading", el("div", "", el("p", "eyebrow", kicker), el("h2", "", title)), ...(control ? [control] : []));
}

type RoomList = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: PublicRoom[] };

export class HomeScreen {
  readonly root = el("section", "home");
  readonly name = nameField();
  private readonly invite = el("input");
  private readonly list = el("ul", "public-list");
  private readonly listStatus = el("p", "empty small");
  private readonly intro = el("p", "note");
  private readonly inviteStatus = el("p", "note");
  private readonly quick = submit("Play with bots");
  private readonly create: HTMLButtonElement;
  private readonly resume: HTMLButtonElement;
  private readonly join = submit("Join", "btn secondary");
  private readonly refresh: HTMLButtonElement;
  private ready = false;
  private guestName = "";

  constructor(hooks: {
    quick: () => void;
    create: () => void;
    resume: () => void;
    join: (code: string) => void;
    publicJoin: (id: string) => void;
    refresh: () => void;
  }) {
    const form = el("form", "hero-copy");
    const headline = el("h1", "", "Find your ", el("em", "", "fourth."));
    const lead = el("p", "detail", "A place for Changsha mahjong. Bring friends, take an open seat, or call in three bots.");
    this.create = button("Create table", "btn secondary", hooks.create);
    this.resume = button("Resume your table", "btn primary", hooks.resume);
    this.quick.append(icon("arrow"));
    this.intro.setAttribute("role", "status");
    this.intro.hidden = true;
    form.append(el("p", "eyebrow", "Four seats · one table"), headline, lead, field("Display name", this.name),
      el("div", "hero-actions", this.resume, this.quick, this.create), this.intro);
    form.addEventListener("submit", event => { event.preventDefault(); hooks.quick(); });

    const tiles = el("div", "sample-tiles", ...[0, 1, 2].map(index =>
      el("span", "tile-target", el("span", "tile-face tile-back", ...(index === 1 ? [icon("lantern")] : [])))));
    const decoration = el("div", "hero-art", tiles);
    decoration.setAttribute("aria-hidden", "true");
    const hero = el("div", "panel hero", form, decoration);

    this.refresh = iconButton("refresh", "Refresh public tables", hooks.refresh);
    this.listStatus.setAttribute("role", "status");
    this.list.setAttribute("aria-label", "Joinable public tables");
    const publicPanel = el("section", "panel",
      panelHeading("Walk in", "Public tables", this.refresh),
      el("p", "detail", "Only tables with an open seat are listed."), this.listStatus, this.list);

    this.invite.autocomplete = "off";
    this.invite.spellcheck = false;
    this.invite.placeholder = "Paste a code or link";
    this.invite.maxLength = 512;
    const fragment = inviteCode(location.hash);
    if (fragment) {
      this.invite.value = fragment;
      text(this.inviteStatus, "Invitation detected. Join when you’re ready.");
    }
    this.inviteStatus.setAttribute("role", "status");
    const inviteForm = el("form", "invite-form", field("Invitation", this.invite), this.join);
    inviteForm.addEventListener("submit", event => {
      event.preventDefault();
      if (!this.ready) return;
      const code = inviteCode(this.invite.value);
      if (code) {
        text(this.inviteStatus, "");
        hooks.join(code);
      } else {
        text(this.inviteStatus, "Enter a valid invitation code or link.");
        this.invite.focus();
      }
    });
    const privatePanel = el("section", "panel",
      panelHeading("By invitation", "Join friends"),
      el("p", "detail", "An invite-only table won’t appear in the public list."), inviteForm, this.inviteStatus);
    this.root.append(hero, ...(fragment ? [privatePanel, publicPanel] : [publicPanel, privatePanel]));
    this.publicJoin = hooks.publicJoin;
  }

  private readonly publicJoin: (id: string) => void;

  identity(guest: Guest): void {
    if (this.name.value === this.guestName) this.name.value = guest.displayName === "Guest" ? "" : guest.displayName;
    this.guestName = guest.displayName === "Guest" ? "" : guest.displayName;
  }

  consumedInvitation(): void {
    this.invite.value = "";
    text(this.inviteStatus, "");
  }

  controls(online: boolean, saved: boolean, hasGuest: boolean, message: string): void {
    this.ready = online && !saved;
    if (this.name.disabled !== !hasGuest) this.name.disabled = !hasGuest;
    this.resume.hidden = !saved;
    this.resume.disabled = !online;
    this.quick.hidden = this.create.hidden = saved;
    this.quick.disabled = this.create.disabled = this.join.disabled = !this.ready;
    this.refresh.disabled = !hasGuest;
    this.intro.hidden = !message;
    text(this.intro, message);
    this.list.querySelectorAll("button").forEach(control => { control.disabled = !this.ready; });
  }

  rooms(state: RoomList): void {
    const items = state.kind === "ready" ? state.items : [];
    const description = state.kind === "loading" ? "Looking for open tables…" : state.kind === "error" ?
      "Couldn’t load the list. Use Refresh public tables to try again." : "No open public tables. Create one or use an invitation.";
    this.listStatus.hidden = items.length > 0;
    text(this.listStatus, description);
    reconcile(this.list, items, item => item.roomId, item => {
      const summary = el("span", "small");
      const control = button("Join table", "btn secondary", () => this.publicJoin(item.roomId));
      return el("li", "room-row", summary, control);
    }, (node, item) => {
      text(node.firstElementChild!, `${item.occupiedSeats} / 4 seats · ${item.matchHands === 1 ? "One hand" : "Four hands"}`);
      const control = node.querySelector("button")!;
      control.disabled = !this.ready;
      control.setAttribute("aria-label", `Join public table with ${item.occupiedSeats} of 4 seats, ${item.matchHands === 1 ? "one hand" : "four hands"}`);
    });
  }
}

export class WaitingRoom {
  readonly root = el("section", "panel waiting");
  private readonly seats = el("div", "lobby-seats");
  private readonly visibility = el("span", "chip");
  private readonly match = el("span", "chip");
  private readonly role = el("span", "chip gold");
  private readonly hint = el("p", "detail");
  private readonly ready: HTMLButtonElement;
  private readonly start: HTMLButtonElement;
  private readonly invite: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private state: Snapshot | null = null;
  private enabled = false;

  constructor(private readonly hooks: {
    ready: (ready: boolean) => void; bot: (seat: Seat, enabled: boolean) => void; start: () => void;
    invite: () => void; leave: () => void;
  }) {
    this.ready = button("Mark ready", "btn primary", () => {
      const seat = this.state?.room.seats.find(item => item.seat === this.state?.self.seat);
      if (seat) hooks.ready(!seat.ready);
    });
    this.start = button("Start match", "btn primary", hooks.start);
    this.invite = button("Invite friends", "btn secondary", hooks.invite);
    this.leave = button("Leave table", "btn subtle", hooks.leave);
    const hero = el("div", "room-heading", el("div", "", el("p", "eyebrow", "Waiting room"),
      el("h1", "", "Take a seat."), el("p", "detail", "Four seats are needed to start the match.")), this.leave);
    this.seats.setAttribute("aria-label", "Table seats");
    this.hint.setAttribute("role", "status");
    this.root.append(hero, el("div", "room-meta", this.visibility, this.match, this.role), this.seats,
      el("div", "waiting-actions", this.hint, this.ready, this.start, this.invite));
  }

  update(state: Snapshot, enabled: boolean): void {
    this.state = state;
    this.enabled = enabled;
    const { room, self } = state;
    const host = room.hostSeat === self.seat;
    const own = room.seats.find(seat => seat.seat === self.seat);
    const full = room.seats.every(seat => seat.kind !== "open");
    const allReady = full && room.seats.every(seat => seat.ready || seat.kind === "bot");
    text(this.visibility, room.visibility === "invite" ? "Invite only" : "Public");
    text(this.match, room.matchHands === 1 ? "One hand" : "Four hands");
    text(this.role, host ? "You’re the host" : "Guest seat");
    this.leave.disabled = !enabled;
    this.invite.hidden = !self.inviteCode;
    this.start.hidden = !host;
    this.start.disabled = !enabled || !allReady;
    this.ready.disabled = !enabled;
    this.ready.className = `btn ${own?.ready ? "secondary" : "primary"}`;
    text(this.ready, own?.ready ? "Not ready" : "Mark ready");
    text(this.hint, !full ? (host ? "Add bots or invite friends to fill the open seats." : "Waiting for more players.") :
      !allReady ? "All human players must mark ready." : host ? "Everyone is ready. Start when you like." : "Everyone is ready. Waiting for the host to start.");
    reconcile(this.seats, room.seats, seat => String(seat.seat), seat => this.card(seat), (node, seat) => {
      const caption = node.querySelector("h2")!;
      const details = node.querySelector("p")!;
      const bot = node.querySelector("button")!;
      node.classList.toggle("self", seat.seat === self.seat);
      text(caption, seat.kind === "open" ? "Open seat" : `${seat.displayName ?? "Player"}${seat.seat === self.seat ? " (you)" : ""}`);
      text(details, seat.kind === "open" ? winds[seat.seat] :
        `${winds[seat.seat]}${seat.seat === room.hostSeat ? " · Host" : ""} · ${
          seat.kind === "bot" ? "Bot · Ready" : `${seat.connected ? "Online" : "Away"} · ${seat.ready ? "Ready" : "Not ready"}`}`);
      bot.hidden = !host || seat.kind === "human";
      bot.disabled = !this.enabled;
      text(bot, seat.kind === "bot" ? "Remove bot" : "Add bot");
      bot.setAttribute("aria-label", `${seat.kind === "bot" ? "Remove bot from" : "Add bot to"} ${winds[seat.seat]} seat`);
    });
  }

  private card(seat: RoomSeat): HTMLElement {
    const wind = el("span", "seat-wind", winds[seat.seat][0]);
    wind.setAttribute("aria-hidden", "true");
    const bot = button("Add bot", "btn subtle", () => {
      const current = this.state?.room.seats.find(item => item.seat === seat.seat);
      if (current) this.hooks.bot(seat.seat, current.kind === "open");
    });
    return el("article", "seat-card", wind, el("div", "", el("h2"), el("p")), bot);
  }
}

export function rulesContent(): HTMLElement {
  return el("div", "form rules-content",
    el("p", "", "This table uses the provisional changsha-v1 profile. Local variations exist."),
    el("h3", "", "The table"),
    el("p", "", "Four seats share 108 tiles: bamboo, characters and dots, with four of each numbered tile. East marks the dealer. Your drawn tile is marked separately."),
    el("h3", "", "Your turn"),
    el("p", "", "Choose from the actions shown. To discard, select one tile in your hand, then confirm with the separate discard button. The table clock continues while a dialog is open."),
    el("h3", "", "Claims and wins"),
    el("p", "", "Chow makes a sequence, Peng makes three matching tiles, and a Kong uses four. Changsha also has opening reveals, special wins, and bird scoring. The table offers only the choices your seat can make; use Pass to decline an optional claim."),
    el("h3", "", "After a hand"),
    el("p", "", "See hand scores and any winning patterns, then continue if there are more hands. At the end, the host can rematch with the same seats."));
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export class ChatPanel {
  readonly root = el("div", "form");
  readonly input = el("input", "chat-input");
  private readonly log = el("div", "chat-log");
  private readonly empty = el("p", "note", "No messages yet. Say hello.");
  private readonly send = submit("Send");

  constructor(post: (value: string) => void) {
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-label", "Table messages");
    this.log.setAttribute("aria-relevant", "additions");
    this.log.tabIndex = 0;
    this.input.setAttribute("aria-label", "Message");
    this.input.placeholder = "Write a message…";
    this.input.maxLength = 300;
    this.input.autocomplete = "off";
    const form = el("form", "chat-composer", this.input, this.send);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const value = this.input.value.trim();
      if (!this.send.disabled && value) post(value);
    });
    this.root.append(this.empty, this.log, form);
  }

  update(messages: ChatMessage[], self: Seat, enabled: boolean): void {
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 42;
    this.empty.hidden = messages.length !== 0;
    this.log.hidden = messages.length === 0;
    reconcile(this.log, messages, item => item.messageId, item => {
      const date = new Date(item.sentAtUtc);
      const stamp = Number.isFinite(date.getTime()) ? clockFormat.format(date) : "";
      const byline = el("p", "small", `${item.displayName}${stamp ? ` · ${stamp}` : ""}`);
      return el("article", `chat-msg${item.seat === self ? " mine" : ""}`, byline, el("p", "", item.text));
    });
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    this.send.disabled = !enabled;
  }

  committed(value: string): void {
    if (this.input.value.trim() === value) this.input.value = "";
  }

  reset(): void {
    this.input.value = "";
    this.log.replaceChildren();
  }
}

const winNames = { selfDraw: "Self-draw", discard: "Claimed discard", robKong: "Robbed kong" };
const sign = (value: number) => value > 0 ? `+${value}` : String(value);

function resultRack(name: string, tiles: Face[], style = ""): HTMLElement {
  const rack = el("div", `meld-group ${style}`, el("div", "result-tiles", ...tiles.map(face => tileLabel(face))),
    el("span", "meld-caption", name));
  rack.setAttribute("role", "group");
  rack.setAttribute("aria-label", name);
  return rack;
}

export function resultsContent(state: Snapshot, actions: HTMLElement[]): HTMLElement {
  const game = state.game!;
  const settlement = game.settlement!;
  const seatName = (seat: Seat) => state.room.seats.find(item => item.seat === seat)?.displayName ?? winds[seat];
  const summary = settlement.reason === "draw" ? "The hand ended in a draw." : `${settlement.winners.map(item => seatName(item.seat)).join(" and ")} won this hand.`;
  const root = el("div", "form", el("p", "eyebrow", `Hand ${game.handNumber} of ${state.room.matchHands}`),
    el("p", "detail", summary));
  const head = el("thead", "", el("tr", "", el("th", "", "Seat"), el("th", "", "Hand"), el("th", "", "Total")));
  const deltas = el("tbody");
  settlement.seatResults.forEach(row => {
    const name = el("th", "", `${seatName(row.seat)}${row.seat === state.self.seat ? " (you)" : ""}`);
    name.scope = "row";
    const points = el("td", row.delta > 0 ? "positive" : row.delta < 0 ? "negative" : "", sign(row.delta));
    deltas.append(el("tr", "", name, points, el("td", "", sign(row.total))));
  });
  const scoreboard = el("table", "scoreboard", el("caption", "sr-only", "Per-seat score changes and match totals"), head, deltas);
  root.append(scoreboard);
  if (settlement.reason === "win") {
    const hands = el("div", "form winning-hands");
    for (const winner of settlement.winners) {
      const winnerNode = el("section", "winner", el("h3", "", `${seatName(winner.seat)} · ${winNames[winner.winBy]}`));
      const tiles = el("div", "result-tiles");
      if (winner.winningHand) {
        setMelds(tiles, winner.winningHand.melds, game.dealerSeat);
        if (winner.winningHand.concealedTiles.length) tiles.prepend(resultRack("Concealed tiles", winner.winningHand.concealedTiles));
      }
      if (winner.winningTiles.length) tiles.append(resultRack("Winning tile", winner.winningTiles, "winning-event"));
      if (tiles.childElementCount) winnerNode.append(tiles);
      if (winner.patterns.length) winnerNode.append(el("ul", "inline-list",
        ...winner.patterns.map(pattern => el("li", "", `${pattern.label} · ${pattern.points}`))));
      hands.append(winnerNode);
    }
    root.append(hands);
  }
  if (settlement.birds.length) root.append(el("section", "result-section", el("h3", "", "Birds"),
    el("div", "result-tiles", ...settlement.birds.map(face => tileLabel(face)))));
  if (settlement.transfers?.length) root.append(el("section", "result-section", el("h3", "", "Score transfers"),
    el("ul", "inline-list", ...settlement.transfers.map(transfer =>
      el("li", "", `${seatName(transfer.fromSeat)} → ${seatName(transfer.toSeat)}: ${transfer.points} (${transfer.reason})`)))));
  if (state.room.status === "betweenHands") root.append(el("p", "note", `Next dealer: ${seatName(settlement.nextDealerSeat)}.`));
  if (actions.length) root.append(el("div", "row-actions", ...actions));
  return root;
}

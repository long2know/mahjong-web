import type { ActorMoment, SeatCast } from "./actors";
import { button, el, places, reconcile, text, wind } from "./dom";
import { center, seatSpot, TableEffects } from "./effects";
import type { Game, GameSeat, Meld, Option, OptionKind, RoomSeat, Seat, Snapshot, Tile } from "./protocol";
import { faceName, tileFace, tileLabel } from "./tile";

const meldNames = { chi: "Chow", peng: "Peng", gang: "Kong", bu: "Supplement" } as const;
const optionNames: Record<OptionKind, string> = {
  discard: "Discard", draw: "Draw", chi: "Chow", peng: "Peng", gang: "Roll for Kong", bu: "Supplement",
  hu: "Hu · Win", pass: "Pass", reveal: "Reveal",
};
const choiceOrder: OptionKind[] = ["hu", "reveal", "gang", "bu", "peng", "chi", "draw", "pass"];
const windowNames = {
  turn: "Turn", opening: "Opening reveal", discard: "Claim window", kong: "Kong response", lastTile: "Last tile",
} as const;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function meldKey(meld: Meld, index: number): string {
  return `${index}:${meld.kind}:${meld.method ?? ""}:${meld.fromSeat ?? "_"}:${meld.tiles.join("/")}`;
}

function meldGroup(meld: Meld, local: boolean, index: number): HTMLElement {
  const method = meld.method ?? (meld.fromSeat === null ? "concealed" : "open");
  const node = el("div", `meld-group meld-${method}`);
  const label = el("span", "meld-caption");
  const tiles = el("div", "meld-tiles");
  node.setAttribute("role", "group");
  node.append(tiles, label);
  meld.tiles.forEach((face, i) => {
    const tile = tileLabel(face, "meld-tile");
    if (local) tile.dataset.meldTile = `${index}-${i}`;
    if (i === 2 && meld.fromSeat !== null && meld.kind !== "chi") tile.classList.add("sourced");
    if (i === 3 && method === "added") tile.classList.add("stacked");
    tiles.append(tile);
  });
  return node;
}

export function setMelds(parent: HTMLElement, melds: Meld[], dealer: Seat, local = false): void {
  reconcile(parent, melds, meldKey, (meld, index) => meldGroup(meld, local, index), (node, meld) => {
    const from = meld.fromSeat === null ? null : wind(meld.fromSeat, dealer);
    const method = meld.method === "added" ? "Added " : meld.method === "concealed" ? "Concealed " : "";
    const label = `${method}${meldNames[meld.kind]}${from ? ` · from ${from}` : ""}`;
    node.setAttribute("aria-label", label);
    text(node.lastElementChild!, label);
  });
}

export type TableCue = "draw" | "discard" | "call" | "turn" | "win" | "exhausted";

const signed = (points: number) => points > 0 ? `+${points}` : points < 0 ? `−${-points}` : "0";

interface Lane {
  name: HTMLElement;
  wind: HTMLElement;
  details: HTMLElement;
  label: HTMLElement;
  wall: HTMLElement;
  backs: HTMLElement;
  river: HTMLElement;
  melds: HTMLElement;
  reveals: HTMLElement;
  score: HTMLElement;
  feedback: HTMLElement;
}

function lane(stage: HTMLElement, plane: HTMLElement, place: string): Lane {
  const wall = el("div", `wall wall--${place}`);
  const backs = el("div", `backs backs--${place}`);
  const river = el("ol", `river river--${place}`);
  const label = el("div", `seat-label seat-label--${place}`);
  const wind = el("span", "seat-wind");
  wind.setAttribute("aria-hidden", "true");
  const name = el("strong", "seat-name");
  const details = el("span", "seat-details");
  const count = el("span", "sr-only");
  const melds = el("div", "edge-melds");
  const reveals = el("div", "edge-reveals");
  const score = el("span", "seat-score");
  const feedback = el("span", "seat-feedback");
  feedback.setAttribute("aria-hidden", "true");
  feedback.hidden = true;
  label.append(wind, el("div", "seat-label-text", name, details, count), score, feedback, melds, reveals);
  stage.append(label);
  plane.append(wall, backs, river);
  for (const element of [wall, backs]) element.setAttribute("aria-hidden", "true");
  return { name, wind, details, label, wall, backs, river, melds, reveals, score, feedback };
}

function blocks(parent: HTMLElement, count: number): void {
  while (parent.childElementCount > count) parent.lastElementChild!.remove();
  while (parent.childElementCount < count) parent.append(el("span"));
}

function updateLane(
  lane: Lane, lobby: RoomSeat, game: GameSeat, self: Seat, dealer: Seat,
  active: boolean, wall: number, latest: boolean,
): void {
  const own = lobby.seat === self;
  const direction = wind(lobby.seat, dealer);
  text(lane.name, own ? "You" : lobby.displayName ?? "Open seat");
  text(lane.wind, direction[0]);
  lane.label.classList.toggle("current", active);
  lane.label.classList.toggle("quiet-seat", lobby.kind === "human" && !lobby.connected);
  lane.label.dataset.seat = String(lobby.seat);
  const isDealer = lobby.seat === dealer;
  const presence = lobby.kind === "bot" ? " · Bot" : lobby.kind === "human" && !lobby.connected ? " · Away" : "";
  text(lane.details, `${isDealer ? "Dealer" : direction}${presence}`);
  text(lane.score, game.total);
  lane.score.setAttribute("aria-label", `${game.total} points`);
  lane.label.title = `${direction}${isDealer ? " · Dealer" : ""} · ${lobby.displayName ?? "Open seat"} · ${game.concealedCount} concealed · ${game.total} points`;
  lane.river.setAttribute("aria-label", `${direction} discards, oldest first`);
  blocks(lane.wall, wall);
  blocks(lane.backs, own ? 0 : game.concealedCount);
  if (!own) {
    text(lane.details.nextElementSibling!, `${isDealer ? `, ${direction} wind` : ""}, ${game.concealedCount} concealed tiles`);
    setMelds(lane.melds, game.melds, dealer);
  }
  reconcile(lane.river, game.discards, (face, i) => `${i}:${face}`, face =>
    el("li", "river-tile", tileLabel(face)), (node, _, i) =>
    node.classList.toggle("last-discard", latest && i === game.discards.length - 1));
  reconcile(lane.reveals, game.revealedTiles, (face, i) => `${i}:${face}`, face => tileLabel(face));
}

function optionButton(option: Option, choose: (optionId: string) => void): HTMLButtonElement {
  const important = option.kind === "hu" || option.kind === "draw";
  const node = button("", `btn ${important ? "primary" : "secondary"} choose`, () => choose(option.optionId));
  node.dataset.option = option.kind;
  node.append(el("span", "", optionNames[option.kind]));
  if (option.faces.length) {
    const previews = el("span", "choice-tiles");
    previews.append(...option.faces.slice(0, 4).map(face => tileLabel(face)));
    if (option.faces.length > 4) previews.append(el("small", "", `+${option.faces.length - 4}`));
    node.append(previews);
    node.setAttribute("aria-label", `${optionNames[option.kind]}: ${option.faces.map(faceName).join(", ")}`);
  }
  return node;
}

export interface TableHooks {
  choose: (option: Option) => void;
  selected: () => void;
  results: () => void;
  pause: () => void;
  motionStopped?: () => void;
}

export class TableView {
  readonly root = el("section", "play");
  private readonly stage = el("div", "board-stage");
  private readonly plane = el("div", "board-plane");
  private readonly lanes = places.map(place => lane(this.stage, this.plane, place));
  private readonly hand = el("div", "hand-grid");
  private readonly melds = el("div", "local-melds");
  private readonly wallText = el("strong", "wall-count");
  private readonly tableCaption = el("span", "table-caption");
  private readonly trigger = el("div", "center-trigger");
  private readonly handTitle = el("span", "rack-title");
  private readonly phase = el("strong", "turn-title");
  private readonly gameInfo = el("span", "game-info");
  private readonly timer = el("strong", "timer");
  private readonly hint = el("p", "action-hint");
  private readonly choices = el("div", "choice-list");
  private readonly discard = button("Discard tile", "btn primary discard-confirm", () => this.confirm());
  private readonly resultButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly reduceMotion = matchMedia(reducedMotionQuery);
  private readonly effects = new TableEffects();
  #cast?: SeatCast;
  #castLoad?: Promise<void>;
  #pendingCast?: (cast: SeatCast) => void;
  #needsVisibleBaseline = false;
  private state: Snapshot | null = null;
  private canAct = false;
  private selection: string | null = null;
  private discardOptions = new Map<string, Option>();
  private open = false;
  private options: Option[] = [];

  constructor(private readonly hooks: TableHooks) {
    this.root.setAttribute("aria-label", "Mahjong table");
    this.stage.setAttribute("aria-label", "Four-seat table and discard rivers");
    const well = el("div", "board-well");
    const corners = ["nw", "ne", "sw", "se"].map(position => {
      const marker = el("i", `plane-corner corner-${position}`);
      marker.dataset.corner = position;
      marker.setAttribute("aria-hidden", "true");
      return marker;
    });
    const center = el("div", "board-center", this.tableCaption, el("div", "center-wall", this.wallText, " wall"), this.trigger);
    this.plane.prepend(well, ...corners);
    this.plane.append(center);
    this.stage.prepend(this.plane);
    this.resultButton = button("View results", "btn primary", hooks.results);
    this.pauseButton = button("Pause", "btn subtle pause-btn", hooks.pause);
    const status = el("div", "turnbar", el("div", "turn-ident", this.phase, this.gameInfo),
      el("div", "turn-tools", this.timer, this.pauseButton));
    this.timer.setAttribute("role", "timer");
    this.timer.setAttribute("aria-live", "off");
    this.phase.setAttribute("role", "status");
    this.choices.setAttribute("aria-label", "Available table actions");
    const rack = el("section", "rack", this.handTitle, this.melds, this.hand);
    rack.setAttribute("aria-label", "Your tiles");
    this.hand.setAttribute("aria-label", "Concealed hand");
    this.melds.setAttribute("aria-label", "Your melds");
    const actions = el("div", "table-actions", this.hint, this.choices, this.discard, this.resultButton);
    this.hint.setAttribute("aria-live", "polite");
    this.root.append(status, this.stage, rack, actions, this.effects.root);
    const stopMotion = () => {
      this.effects.clear();
      this.#clearCast();
      this.hooks.motionStopped?.();
    };
    this.reduceMotion.addEventListener("change", event => { if (event.matches) stopMotion(); });
    const stopIfStill = () => { if (!this.motionEnabled) stopMotion(); };
    new MutationObserver(stopIfStill).observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-reduced-motion"],
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.#needsVisibleBaseline = true;
      stopIfStill();
    });
    const viewport = window.visualViewport;
    const size = () => [innerWidth, innerHeight, viewport?.width, viewport?.height, viewport?.scale].join();
    let dimensions = size();
    const resizeCast = () => {
      const current = size();
      if (current !== dimensions) {
        dimensions = current;
        this.#clearCast();
      }
    };
    window.addEventListener("resize", resizeCast);
    viewport?.addEventListener("resize", resizeCast);
    rack.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.selection) {
        this.selection = null;
        this.paintActions();
      }
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) &&
        event.target instanceof HTMLButtonElement && event.target.dataset.tileId !== undefined) {
        const tiles = Array.from(this.hand.querySelectorAll("button"));
        const i = tiles.indexOf(event.target);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tiles.length - 1 :
          Math.max(0, Math.min(tiles.length - 1, i + (event.key === "ArrowRight" ? 1 : -1)));
        event.preventDefault();
        tiles[next]?.focus();
      }
    });
  }

  private tile(node: Tile): HTMLButtonElement {
    const target = button("", "tile-target hand-tile", () => {
      if (!this.open || !this.discardOptions.has(node.tileId)) return;
      this.selection = this.selection === node.tileId ? null : node.tileId;
      this.hooks.selected();
      this.paintActions();
    });
    target.dataset.tileId = node.tileId;
    target.append(tileFace(node.face), el("span", "draw-mark", "DRAW"));
    return target;
  }

  get motionEnabled(): boolean {
    // WebKit can keep the subscribed list stale until the next media change event.
    return !document.hidden && document.documentElement.dataset.reducedMotion !== "true" &&
      !matchMedia(reducedMotionQuery).matches;
  }

  async #loadCast(): Promise<void> {
    const layer = el("div", "seat-cast");
    try {
      const { SeatCast } = await import("./actors");
      layer.setAttribute("aria-hidden", "true");
      const cast = this.#cast = new SeatCast(layer, this.plane.querySelector<HTMLElement>(".board-center")!);
      this.plane.after(layer);
      const state = this.state;
      if (state?.game && this.stage.isConnected) {
        cast.present(state);
        this.#pendingCast?.(cast);
      }
      this.#pendingCast = undefined;
    } catch (error) {
      this.#cast = this.#pendingCast = undefined;
      layer.remove();
      console.warn("Seat art unavailable.", error);
    }
  }

  #clearCast(): void {
    this.#pendingCast = undefined;
    this.#cast?.clear();
  }

  update(state: Snapshot, canAct: boolean, now: number, effect = false): TableCue | undefined {
    const game = state.game;
    const previous = this.state;
    this.state = state;
    const { self, room } = state;
    const sameTable = previous?.roomId === state.roomId && previous.self.seat === self.seat;
    const sameHand = previous?.game?.handNumber === game?.handNumber;
    const settling = game?.settlement && !previous?.game?.settlement;
    const changed = !sameTable || previous.gameRevision !== state.gameRevision;
    const live = sameTable && effect && previous.gameRevision + 1 === state.gameRevision &&
      !previous.room.paused && !room.paused && !document.hidden && !this.#needsVisibleBaseline;
    // A snapshot delivered after the browser was suspended might be a queued commit.
    if (changed) this.#needsVisibleBaseline = false;
    const still = room.paused || !this.motionEnabled;
    if (changed || still) this.effects.clear();
    if ((!live && changed) || still || !sameHand || settling) this.#clearCast();
    else if (changed) this.#pendingCast = undefined;
    this.#castLoad ??= this.#loadCast();
    if (!game) return;
    const motion = live && !still;
    const cast = this.#cast;
    cast?.present(state, motion);
    const priorGame = live && sameHand ? previous.game : null;
    const deal = motion && room.status === "playing" && !game.settlement && (
      previous.room.status === "waiting" && !previous.game && game.handNumber === 1 ||
      previous.room.status === "betweenHands" && previous.game?.settlement &&
        game.handNumber === previous.game.handNumber + 1
    );
    const newSettlement = priorGame && settling;
    let discardOrigin: ReturnType<typeof center> | undefined;
    if (motion && priorGame) {
      const oldRiver = priorGame.seats.find(item => item.seat === self.seat)?.discards;
      const river = game.seats.find(item => item.seat === self.seat)?.discards;
      if (oldRiver && river?.length === oldRiver.length + 1) {
        const removed = previous.self.hand.filter(tile =>
          tile.face === river.at(-1) && !self.hand.some(held => held.tileId === tile.tileId));
        if (removed.length === 1) {
          const target = Array.from(this.hand.children).find(tile => (tile as HTMLElement).dataset.tileId === removed[0].tileId);
          if (target) discardOrigin = center(target);
        }
      }
    }
    if (!sameTable || previous.game?.window?.windowId !== game.window?.windowId) this.selection = null;
    this.canAct = canAct;
    this.options = self.legalOptions;
    this.discardOptions = new Map(self.legalOptions.filter(option => option.kind === "discard" && option.tileIds.length === 1)
      .map(option => [option.tileIds[0], option]));
    if (this.selection && !this.discardOptions.has(this.selection)) this.selection = null;

    text(this.wallText, game.wallCount);
    text(this.tableCaption, `Hand ${game.handNumber} / ${room.matchHands}`);
    text(this.gameInfo, `${wind(self.seat, game.dealerSeat)} seat${self.seat === game.dealerSeat ? " · Dealer" : ""}`);
    text(this.phase, this.phaseText(game, room.seats, self.seat, room.paused));
    const trigger = game.window?.trigger;
    reconcile(this.trigger, trigger?.faces ?? [], (face, i) => `${i}:${face}`, face => tileLabel(face));
    this.trigger.setAttribute("aria-label", trigger ? `${wind(trigger.seat, game.dealerSeat)} played` : "");
    this.pauseButton.hidden = room.status !== "playing" || self.seat !== room.hostSeat;
    this.pauseButton.disabled = !canAct;
    text(this.pauseButton, room.paused ? "Resume" : "Pause");

    const discards: { lane: Lane; seat: Seat; face: Tile["face"]; own: boolean }[] = [];
    const calls: { lane: Lane; seat: Seat; kind: Meld["kind"] | "reveal" }[] = [];
    const scores: { lane: Lane; seat: Seat; delta: number; cause: string }[] = [];
    this.lanes.forEach((lane, i) => {
      const seat = ((self.seat + i) % 4) as Seat;
      const lobby = room.seats.find(item => item.seat === seat);
      const table = game.seats.find(item => item.seat === seat);
      if (!lobby || !table) return;
      const before = priorGame?.seats.find(item => item.seat === seat);
      const blocksLeft = Math.ceil(game.wallCount / 3);
      const count = Math.floor(blocksLeft / 4) + (seat < blocksLeft % 4 ? 1 : 0);
      // An added-kong trigger uses the matching Peng and the drawn fourth copy,
      // so no matching face can still be in the river during a robbery offer.
      const pendingDiscard = game.phase === "claim" && trigger?.seat === seat &&
        trigger.faces.length === 1 && trigger.faces[0] === table.discards.at(-1);
      updateLane(lane, lobby, table, self.seat, game.dealerSeat,
        game.turnSeat === seat && game.phase === "turn", count, pendingDiscard);
      if (before && table.discards.length === before.discards.length + 1) {
        discards.push({ lane, seat, face: table.discards.at(-1)!, own: seat === self.seat });
      }
      if (seat === self.seat) {
        setMelds(this.melds, table.melds, game.dealerSeat, true);
        this.melds.hidden = table.melds.length === 0;
      }
      const score = game.settlement?.seatResults.find(result => result.seat === seat);
      const winner = game.settlement?.winners.find(result => result.seat === seat);
      if (score) {
        lane.feedback.hidden = false;
        lane.feedback.dataset.kind = score.delta < 0 ? "loss" : "score";
        const cause = winner?.winBy === "selfDraw" ? "Self-draw" : winner?.winBy === "robKong" ? "Rob kong" : winner ? "Hu" : "";
        text(lane.feedback, `${cause ? `${cause} · ` : ""}${signed(score.delta)}`);
        if (newSettlement) scores.push({ lane, seat, delta: score.delta, cause });
      } else if (changed || room.paused) {
        const meld = before && table.melds.find((item, index) => meldKey(item, index) !==
          (before.melds[index] && meldKey(before.melds[index], index)));
        const kind = meld?.kind ?? (before && table.revealedTiles.length > before.revealedTiles.length ? "reveal" : null);
        lane.feedback.hidden = !kind;
        lane.feedback.dataset.kind = "call";
        text(lane.feedback, kind === "reveal" ? "Reveal" : kind ? meldNames[kind] : "");
        if (kind) calls.push({ lane, seat, kind });
      }
    });

    const ordered = self.hand.filter(tile => tile.tileId !== self.drawnTileId)
      .sort((a, b) => a.face.localeCompare(b.face) || a.tileId.localeCompare(b.tileId));
    const drawn = self.hand.find(tile => tile.tileId === self.drawnTileId);
    const newDraw = live && !!drawn && drawn.tileId !== previous.self.drawnTileId;
    if (drawn) ordered.push(drawn);
    text(this.handTitle, `Your hand · ${self.hand.length} concealed`);
    reconcile(this.hand, ordered, tile => tile.tileId, tile => this.tile(tile), (node, tile) => {
      const isDrawn = tile.tileId === self.drawnTileId;
      node.classList.toggle("is-drawn", isDrawn);
      node.setAttribute("aria-label", `${faceName(tile.face)}${isDrawn ? ", drawn tile" : ""}`);
    });
    const nonDiscards = self.legalOptions.filter(option => option.kind !== "discard")
      .sort((a, b) => choiceOrder.indexOf(a.kind) - choiceOrder.indexOf(b.kind));
    reconcile(this.choices, nonDiscards, option => option.optionId, option => optionButton(option, id => this.choose(id)));
    this.resultButton.hidden = !game.settlement;
    text(this.resultButton, room.status === "complete" ? "Match results" : "Hand results");
    this.tick(now, true);

    const drawFlight = motion && priorGame && newDraw && !previous.self.hand.some(tile => tile.tileId === drawn.tileId);
    if (motion && (deal || drawFlight || discards.length || calls.length || scores.length)) {
      const moments: ActorMoment[] = deal || drawFlight ? [{ seat: self.seat, gesture: "gather" }] : [];
      const surface = this.effects.root.getBoundingClientRect();
      const stage = this.stage.getBoundingClientRect();
      // Read the in-flow anchors before adding any overlay nodes.
      const render: (() => void)[] = [];
      if (deal) {
        // Backed packets are decorative; neither projected wall shows its true order.
        const tiles = Array.from(this.hand.children);
        const origin = center(this.lanes[2].wall);
        for (let i = 0; i < Math.min(4, tiles.length); i++) {
          const to = center(tiles[Math.floor((i + .5) * tiles.length / 4)]);
          render.push(() => this.effects.flight(surface, "deal", { x: origin.x + (i - 1.5) * 13, y: origin.y }, to, null, i * 64));
        }
      }
      if (drawFlight) {
        const target = this.hand.lastElementChild!;
        const from = center(this.lanes[places.indexOf("left")].wall), to = center(target);
        render.push(() => this.effects.flight(surface, "draw", from, to, drawn.face, 0, target.querySelector(".tile-face") ?? undefined));
      }
      for (const { lane, seat, face, own } of discards) {
        const target = lane.river.lastElementChild!;
        const from = (own ? discardOrigin : undefined) ?? center(lane.label);
        const to = center(target);
        moments.push({ seat, gesture: "discard", target });
        render.push(() => this.effects.flight(surface, "discard", from, to, face, 0, target.querySelector(".tile-face") ?? undefined));
      }
      for (const { lane, seat, kind } of calls) {
        const spot = seatSpot(stage, lane.label);
        moments.push({ seat, gesture: "call" });
        render.push(() => this.effects.stamp(surface, spot, kind));
      }
      for (const { lane, seat, delta, cause } of scores) {
        const spot = seatSpot(stage, lane.label);
        if (cause) render.push(() => this.effects.stamp(surface, spot, "win", cause === "Hu" ? "Hu · Win" : cause));
        if (cause || delta < 0) moments.push({ seat, gesture: cause ? "win" : "loss" });
        if (delta) {
          const side = spot.x >= stage.x + stage.width * .48 ? -1 : 1;
          const point = cause ? { x: spot.x + side * 57, y: spot.y + 35 } : spot;
          render.push(() => this.effects.score(surface, point, signed(delta), delta > 0));
        }
      }
      if (cast) cast.play(moments);
      // Only the newest committed cue may survive a briefly cold table chunk.
      else if (moments.length) {
        const until = performance.now() + 260;
        this.#pendingCast = cast => { if (performance.now() < until && this.motionEnabled) cast.play(moments); };
      }
      render.forEach(paint => paint());
    }
    if (newSettlement) return game.settlement!.reason === "win" ? "win" : "exhausted";
    if (calls.length) return "call";
    if (newDraw) return "draw";
    if (discards.length) return "discard";
    if (live && game.turnSeat === self.seat && game.turnSeat !== priorGame?.turnSeat) return "turn";
  }

  private phaseText(game: Game, seats: RoomSeat[], self: Seat, paused: boolean): string {
    if (paused) return "Table paused";
    if (game.phase === "settled") return "Hand complete";
    if (game.window?.reason && game.window.reason !== "turn") return windowNames[game.window.reason];
    if (game.turnSeat === self) return "Your turn";
    if (game.turnSeat !== null) {
      const name = seats.find(seat => seat.seat === game.turnSeat)?.displayName;
      return name ? `${name}’s turn` : `${wind(game.turnSeat, game.dealerSeat)}’s turn`;
    }
    return "At the table";
  }

  tick(now: number, force = false): void {
    if (!this.state) return;
    const { game, room } = this.state;
    const deadline = room.paused ? room.autoResumeAtUtc : game?.window?.deadlineUtc;
    const left = deadline ? Math.max(0, Date.parse(deadline) - now) : 0;
    const seconds = Math.ceil(left / 1000);
    this.timer.hidden = !deadline;
    this.timer.classList.toggle("urgent", !room.paused && seconds <= 5 && this.options.length > 0);
    const timerLabel = room.paused ? `Auto-resume in ${seconds} seconds` : `${seconds} seconds remaining`;
    if (this.timer.getAttribute("aria-label") !== timerLabel) this.timer.setAttribute("aria-label", timerLabel);
    text(this.timer, room.paused ? `Resume in ${seconds}s` : `${seconds}s`);
    const open = this.canAct && !room.paused && !!game?.window && left > 0;
    if (force || open !== this.open) {
      this.open = open;
      this.paintActions();
    }
  }

  clearEffects(): void {
    this.selection = null;
    this.effects.clear();
    this.#clearCast();
    for (const { feedback } of this.lanes) {
      if (feedback.dataset.kind === "call") feedback.hidden = true;
    }
    this.paintActions();
  }

  private paintActions(): void {
    const { room, game, self } = this.state ?? {};
    for (const tile of this.hand.querySelectorAll("button")) {
      const id = tile.dataset.tileId!;
      tile.setAttribute("aria-pressed", String(id === this.selection));
      tile.setAttribute("aria-disabled", String(!this.open || !this.discardOptions.has(id)));
    }
    for (const option of this.choices.querySelectorAll("button")) option.disabled = !this.open;
    this.choices.hidden = this.choices.childElementCount === 0;
    const selected = self?.hand.find(tile => tile.tileId === this.selection);
    this.discard.hidden = this.discardOptions.size === 0;
    this.discard.disabled = !this.open || !selected;
    text(this.discard, selected ? `Discard ${faceName(selected.face)}` : "Discard tile");
    let message: string;
    if (game?.settlement) message = room?.status === "complete" ? "Match finished. See the final scores." : "Review the scores, then start the next hand.";
    else if (room?.paused) message = "Decisions are frozen while the table is paused.";
    else if (this.discardOptions.size) message = selected ? "Confirm your discard." : "Select a tile, then confirm.";
    else if (this.options.length) message = "Choose one of the available actions.";
    else message = game?.phase === "claim" ? "Waiting for eligible players to respond." : "Waiting for the next turn.";
    text(this.hint, message);
  }

  private choose(optionId: string): void {
    const option = this.options.find(item => item.optionId === optionId);
    if (this.open && option) this.hooks.choose(option);
  }

  private confirm(): void {
    const option = this.selection && this.discardOptions.get(this.selection);
    if (this.open && option) this.hooks.choose(option);
  }
}

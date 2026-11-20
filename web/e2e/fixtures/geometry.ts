import "../../src/styles.css";
import { button, el, icon } from "../../src/dom";
import type { Face, Meld, Seat, Snapshot, Tile } from "../../src/protocol";
import { TableView } from "../../src/table";

const params = new URLSearchParams(location.search);
const kongs = params.has("kongs");
if (params.has("insets")) {
  for (const [direction, size] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
    document.documentElement.style.setProperty(`--safe-${direction}`, `${size}px`);
  }
}
const mount = document.querySelector<HTMLElement>("#fixture")!;
const shell = el("main", "shell");
const hand: Tile[] = (kongs ? ["c2", "d5"] : [
  "b1", "b3", "b3", "b6", "b7", "c2", "c2", "c4", "c6", "c9", "d1", "d5", "d6",
]).map((face, i) => ({ tileId: `fixture-tile-${i}`, face: face as Face }));
const drawn: Tile = { tileId: "fixture-draw", face: "d9" };
const seats = [0, 1, 2, 3] as Seat[];
const clock = Date.parse("2030-01-01T00:00:00Z");
const melds: Meld[] = kongs ? [
  { kind: "gang", method: "open", fromSeat: 2, tiles: ["b1", "b1", "b1", "b1"] },
  { kind: "gang", method: "concealed", fromSeat: null, tiles: [null, null, null, null] },
  { kind: "gang", method: "added", fromSeat: 3, tiles: ["d7", "d7", "d7", "d7"] },
  { kind: "gang", method: "open", fromSeat: 1, tiles: ["c4", "c4", "c4", "c4"] },
] : [];

function state(draw: boolean): Snapshot {
  const tiles = draw ? [...hand, drawn] : hand;
  return {
    v: 1, type: "snapshot", roomId: "renderer-fixture", roomRevision: 2, gameRevision: draw ? 2 : 1,
    serverTimeUtc: new Date(clock).toISOString(),
    room: { visibility: "invite", status: "playing", hostSeat: 0, matchHands: 1, paused: false,
      autoResumeAtUtc: null, rulesVersion: "changsha-v1", chat: [], seats: seats.map(seat => ({
        seat, kind: seat === 0 ? "human" : "bot", connected: seat === 0,
        ready: true, displayName: ["River", "Willow", "Ink", "Jade"][seat],
      })) },
    game: {
      handNumber: 1, dealerSeat: 2, phase: "turn", turnSeat: 0, wallCount: 48,
      seats: seats.map(seat => ({ seat, concealedCount: seat === 0 ? tiles.length : 13,
        discards: ["d1", "b2", "c7", "c4", "b1", "d2", "d6", "b3", "b4"],
        melds: seat === 0 ? melds : [], revealedTiles: [], total: 0 })),
      window: { windowId: "fixture-window", anchorGameRevision: 1, reason: "turn",
        deadlineUtc: new Date(clock + 30000).toISOString(), trigger: null },
      settlement: null,
    },
    self: { seat: 0, inviteCode: null, hand: tiles, drawnTileId: draw ? drawn.tileId : null,
      legalOptions: tiles.map(tile => ({ optionId: `drop-${tile.tileId}`, kind: "discard", tileIds: [tile.tileId], faces: [tile.face] })) },
  };
}

mount.dataset.discards = "0";
mount.dataset.hitSequence = "0";
const draw = button("Fixture draw", "btn subtle", () => {
  render(true);
  draw.disabled = true;
});
const table = new TableView({
  selected: () => undefined, pause: () => undefined, results: () => undefined,
  choose: option => {
    mount.dataset.discards = String(Number(mount.dataset.discards) + 1);
    mount.dataset.chosen = option.tileIds[0] ?? "";
  },
});
const header = el("header", "site-header", el("div", "brand", el("span", "brand-symbol", icon("lantern")),
  el("div", "", el("p", "brand-name", "Lantern Table"), el("p", "brand-kicker", "Renderer fixture only"))), draw);
draw.hidden = kongs;
shell.append(header, table.root);
mount.append(shell);

function render(draw: boolean): void { table.update(state(draw), true, clock, draw); }
render(false);

const plane = table.root.querySelector<HTMLElement>(".board-plane")!;
for (const [id, x, y] of [["near", 50, 88], ["left", 14, 25], ["far", 50, 11], ["right", 87, 77]] as const) {
  const probe = button("", "");
  probe.dataset.probe = id;
  probe.setAttribute("aria-label", `Fixture ${id} plane probe`);
  probe.style.cssText = `position:absolute;left:${x}%;top:${y}%;width:14px;height:14px;border:0;border-radius:50%;background:#dfad73;transform:translate(-50%,-50%);z-index:2;`;
  plane.append(probe);
}

document.addEventListener("pointerdown", event => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tile-id], [data-meld-tile], [data-probe]") : null;
  mount.dataset.pointer = event.pointerType;
  mount.dataset.hit = target?.dataset.tileId ?? target?.dataset.meldTile ?? target?.dataset.probe ?? "";
  mount.dataset.hitSequence = String(Number(mount.dataset.hitSequence) + 1);
});

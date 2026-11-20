import { expect, test } from "@playwright/test";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import type { ClientMessage, Command, Face, Meld, Seat, Snapshot, Tile } from "../src/protocol";

const origin = `http://127.0.0.1:${process.env.MAHJONG_GEOMETRY_PORT ?? 4179}`;
const players = ["River", "Willow", "Ink", "Jade"];
const seats = [0, 1, 2, 3] as Seat[];
const hand: Tile[] = (["b1", "b3", "b3", "b6", "b7", "c2", "c2", "c4", "c6", "c9", "d1", "d5", "d6"] as Face[])
  .map((face, i) => ({ tileId: `held-${i}`, face }));
const drawn: Tile = { tileId: "private-draw", face: "d9" };
const layer = ".table-effects";

function frame(rev: number, number = 1, draw = true): Snapshot {
  const tiles = draw ? [...hand, drawn] : hand;
  return {
    v: 1, type: "snapshot", roomId: "motion-room", roomRevision: rev + 5, gameRevision: rev,
    serverTimeUtc: new Date().toISOString(),
    room: { visibility: "invite", status: "playing", hostSeat: 0, matchHands: 4, paused: false,
      autoResumeAtUtc: null, rulesVersion: "changsha-v1", chat: [], seats: seats.map(seat => ({
        seat, kind: seat === 0 ? "human" : "bot", connected: seat === 0, ready: true, displayName: players[seat],
      })) },
    game: {
      handNumber: number, dealerSeat: 0, phase: "turn", turnSeat: draw ? 0 : 3, wallCount: 55,
      seats: seats.map(seat => ({ seat, concealedCount: seat === 0 ? tiles.length : 13,
        discards: [], melds: [], revealedTiles: [], total: 0 })),
      window: { windowId: `turn-${rev}`, anchorGameRevision: rev, reason: "turn", trigger: null,
        deadlineUtc: new Date(Date.now() + 30000).toISOString() },
      settlement: null,
    },
    self: { seat: 0, inviteCode: null, hand: tiles, drawnTileId: draw ? drawn.tileId : null,
      legalOptions: draw ? tiles.map(tile => ({
        optionId: `drop-${tile.tileId}`, kind: "discard", tileIds: [tile.tileId], faces: [tile.face],
      })) : [] },
  };
}

function waiting(rev: number): Snapshot {
  const state = frame(rev, 1, false);
  state.game = null;
  state.room.status = "waiting";
  state.self.hand = [];
  return state;
}

function advance(prior: Snapshot): Snapshot {
  const next = structuredClone(prior);
  next.gameRevision++;
  return next;
}

function settled(prior: Snapshot, winners: Seat[] = [1, 2]): Snapshot {
  const state = advance(prior);
  state.roomRevision++;
  state.room.status = state.game!.handNumber === 4 ? "complete" : "betweenHands";
  state.self.legalOptions = [];
  const game = state.game!;
  game.phase = "settled";
  game.turnSeat = game.window = null;
  game.settlement = { reason: "win", sourceSeat: 0, nextDealerSeat: winners.length > 1 ? 0 : winners[0], birds: [],
    winners: winners.map(seat => ({ seat, winBy: "discard", winningTiles: ["b8"], patterns: [] })),
    seatResults: seats.map(seat => {
      const delta = winners.includes(seat) ? 8 : seat === 0 ? -8 * winners.length : 0;
      return { seat, delta, total: game.seats[seat].total + delta };
    }),
  };
  game.seats.forEach(seat => { seat.total = game.settlement!.seatResults[seat.seat].total; });
  return state;
}

// Only the transport is stubbed. These frames run through the production session, router, renderer and controls.
async function open(page: Page, initial: Snapshot, savedMotion = false) {
  let state = initial;
  const links: WebSocketRoute[] = [];
  const commands: Command[] = [];
  const ack = (socket: WebSocketRoute, requestId: string) => socket.send(JSON.stringify({
    v: 1, type: "ack", requestId, status: "ok", error: null, roomId: state.roomId,
    roomRevision: state.roomRevision, gameRevision: state.gameRevision,
  }));
  const send = (socket: WebSocketRoute) =>
    socket.send(JSON.stringify({ ...state, serverTimeUtc: new Date().toISOString() }));
  await page.addInitScript(selector => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.closest(selector)) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  }, layer);
  await page.route("**/api/guest", route => route.fulfill({ json: {
    displayName: players[0], resumeRoomId: initial.roomId,
    preferences: { sound: false, music: false, volume: .7, reducedMotion: savedMotion },
  } }));
  await page.route("**/api/rooms", route => route.fulfill({ json: { rooms: [] } }));
  await page.routeWebSocket("**/ws", socket => {
    links.push(socket);
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw)) as ClientMessage;
      if (message.type === "sync") {
        ack(socket, message.requestId);
        send(socket);
      } else if (message.type === "command") commands.push(message);
    });
    socket.send(JSON.stringify({ v: 1, type: "lease", lease: "effect-test", serverTimeUtc: new Date().toISOString(),
      expiresAtUtc: new Date(Date.now() + 180000).toISOString() }));
  });
  await page.goto(origin);
  await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
  return {
    commands,
    publish(snapshot: Snapshot, command?: Command) {
      state = snapshot;
      const socket = links.at(-1)!;
      if (command) ack(socket, command.requestId);
      send(socket);
    },
    reconnect(snapshot: Snapshot) {
      state = snapshot;
      links.at(-1)!.close({ code: 1012, reason: "fixture reconnect" });
    },
  };
}

async function seek(page: Page, milliseconds: number) {
  await page.locator(layer).evaluate((root, time) => {
    for (const animation of root.getAnimations({ subtree: true })) animation.currentTime = time;
  }, milliseconds);
}

async function midpoint(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("backed deal packets, turquoise draw and public discard travel without stealing a tap", async ({ page }, testInfo) => {
  const wire = await open(page, waiting(0));
  await expect(page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
  await page.getByRole("button", { name: "Start match" }).tap();
  await expect.poll(() => wire.commands[0]?.op).toBe("start");
  const started = frame(1);
  wire.publish(started, wire.commands[0]);
  const packets = page.locator(".effect-flight--deal.effect-flight");
  await expect(packets).toHaveCount(4);
  await expect(packets.locator(".tile-back")).toHaveCount(4);
  await expect(packets.locator(".tile-art")).toHaveCount(0);
  const rackTile = page.locator("[data-tile-id]").first();
  await expect(rackTile).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(layer)).toHaveCSS("pointer-events", "none");
  const start = await midpoint(packets.first());
  await seek(page, 246);
  const mid = await midpoint(packets.first());
  expect(mid.y - start.y).toBeGreaterThan(55);
  await page.screenshot({ path: testInfo.outputPath("01-portrait-deal-246ms.png") });

  const baseline = frame(3, 1, false);
  baseline.game!.wallCount = 49;
  baseline.game!.seats[3].discards = ["b2"];
  wire.publish(baseline);
  await expect(page.locator(".wall-count")).toHaveText("49");
  await expect(page.locator(`${layer} > *`)).toHaveCount(0);
  const draw = frame(4);
  draw.game!.wallCount = 48;
  draw.game!.seats[3].discards = ["b2"];
  wire.publish(draw);
  const flight = page.locator(".effect-flight--draw.effect-flight");
  await expect(flight).toHaveCount(1);
  const tile = page.getByRole("button", { name: "9 dots, drawn tile" });
  const before = (await tile.boundingBox())!;
  expect(await flight.locator(".tile-art").evaluate(svg => svg.outerHTML))
    .toBe(await tile.locator(".tile-art").evaluate(svg => svg.outerHTML));
  const takeoff = await midpoint(flight);
  await seek(page, 182);
  const moving = await midpoint(flight);
  expect(Math.hypot(moving.x - takeoff.x, moving.y - takeoff.y)).toBeGreaterThan(70);
  await page.screenshot({ path: testInfo.outputPath("02-portrait-draw-182ms.png") });
  await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  expect(await tile.boundingBox()).toEqual(before);
  expect(wire.commands).toHaveLength(1);
  const confirm = page.getByRole("button", { name: "Discard 9 dots" });
  const confirmPoint = await midpoint(confirm);
  await seek(page, 302);
  expect(await midpoint(confirm)).toEqual(confirmPoint);
  await page.touchscreen.tap(confirmPoint.x, confirmPoint.y);
  await expect.poll(() => wire.commands.length).toBe(2);
  await page.touchscreen.tap(confirmPoint.x, confirmPoint.y);
  await expect(confirm).toBeDisabled();
  expect(wire.commands).toHaveLength(2);
  const choice = wire.commands[1];
  expect(choice).toMatchObject({ op: "choose", payload: {
    roomId: draw.roomId, windowId: draw.game!.window!.windowId, anchorGameRevision: draw.gameRevision,
    optionId: draw.self.legalOptions.at(-1)!.optionId,
  } });

  const discard = advance(draw);
  discard.self = { ...baseline.self };
  discard.game!.seats[0].concealedCount--;
  discard.game!.seats[0].discards.push("d9");
  discard.game!.phase = "claim";
  discard.game!.turnSeat = null;
  discard.game!.window = { ...discard.game!.window!, windowId: "claim-5", reason: "discard",
    trigger: { seat: 0, faces: ["d9"] }, anchorGameRevision: discard.gameRevision };
  wire.publish(discard, choice);
  const toss = page.locator(".effect-flight--discard.effect-flight");
  await expect(toss).toHaveCount(1);
  await expect(flight).toHaveCount(0);
  await expect(tile).toHaveCount(0);
  await expect(toss.locator("[data-tile-id]")).toHaveCount(0);
  const from = await midpoint(toss);
  expect(from.x).toBeCloseTo(before.x + before.width / 2, 0);
  expect(from.y).toBeCloseTo(before.y + before.height / 2, 0);
  const river = page.locator(".river--near .last-discard");
  await expect(river.getByRole("img", { name: "9 dots" })).toBeVisible();
  await seek(page, 206);
  await page.screenshot({ path: testInfo.outputPath("03-portrait-discard-206ms.png") });
  await seek(page, 337);
  const landing = await midpoint(toss), target = await midpoint(river);
  expect(Math.hypot(landing.x - target.x, landing.y - target.y)).toBeLessThan(4);
});

test("distinct stamp bursts and two seat-local wins fit the short landscape lead-in", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 320 });
  let state = frame(10, 1, false);
  const wire = await open(page, state);
  await page.evaluate(() => {
    for (const [edge, inset] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
      document.documentElement.style.setProperty(`--safe-${edge}`, `${inset}px`);
    }
  });
  expect((await page.locator(".board-stage").boundingBox())!.x).toBeGreaterThanOrEqual(25);
  const cases: { seat: Seat; label: string; meld: Meld }[] = [
    { seat: 1, label: "Chi", meld: { kind: "chi", fromSeat: 0, tiles: ["b4", "b5", "b6"] } },
    { seat: 2, label: "Peng", meld: { kind: "peng", fromSeat: 3, tiles: ["d3", "d3", "d3"] } },
    { seat: 2, label: "Kong", meld: { kind: "gang", method: "added", fromSeat: 3, tiles: ["d3", "d3", "d3", "d3"] } },
    { seat: 3, label: "Supplement", meld: { kind: "bu", method: "concealed", fromSeat: null, tiles: [null, null, null, null] } },
  ];
  for (const { seat, label, meld } of cases) {
    state = advance(state);
    state.game!.seats[seat].melds = [meld];
    state.game!.seats[seat].concealedCount = meld.kind === "chi" || meld.kind === "peng" ? 11 : 10;
    state.game!.turnSeat = seat;
    wire.publish(state);
    const stamp = page.locator(`.effect-stamp--${meld.kind}`);
    await expect(stamp.locator(".effect-caption")).toHaveText(label);
    await expect(stamp.locator(".effect-ring")).toHaveCount(2);
    await expect(stamp.locator(".effect-spark")).toHaveCount(7);
    await expect(page.locator(`[data-seat="${seat}"] .seat-feedback`)).toHaveText(label);
    const seal = stamp.locator(".effect-seal");
    const small = (await seal.boundingBox())!;
    await seek(page, 108);
    const big = (await seal.boundingBox())!;
    expect(big.width / small.width).toBeGreaterThan(1.7);
    expect(big.y).toBeLessThan(small.y - 20);
    const viewport = page.viewportSize()!;
    expect(big.x).toBeGreaterThan(0);
    expect(big.x + big.width).toBeLessThan(viewport.width);
    if (meld.kind === "peng") {
      expect(big.y).toBeGreaterThanOrEqual((await page.locator(layer).boundingBox())!.y);
      await page.screenshot({ path: testInfo.outputPath("04-compact-peng-108ms.png") });
    }
    if (meld.method === "concealed") {
      await expect(page.locator(`[data-seat="${seat}"] .meld-group .tile-back`)).toHaveCount(4);
      await expect(stamp.locator(".tile-art")).toHaveCount(0);
    }
  }

  wire.publish(settled(state));
  const wins = page.locator(".effect-stamp--win");
  await expect(wins).toHaveCount(2);
  const results = page.getByRole("dialog", { name: "Hand results" });
  await expect(results).toBeHidden();
  await seek(page, 170);
  await page.screenshot({ path: testInfo.outputPath("05-compact-win-score-170ms.png") });
  await expect(page.locator(".effect-score--gain")).toHaveText(["+8", "+8"]);
  await expect(page.locator(".effect-score--loss")).toHaveText("−16");
  await expect(page.locator('[data-seat="1"] .seat-feedback')).toHaveText("Hu · +8");
  await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Hu · +8");
  const left = await midpoint(wins.nth(0)), far = await midpoint(wins.nth(1));
  expect(far.x - left.x).toBeGreaterThan(100);
  expect(left.y - far.y).toBeGreaterThan(15);
  await expect(page.locator(".table-actions").getByText("Hand results", { exact: true })).toBeEnabled();
  await expect(results.getByRole("button", { name: "Next hand" })).toBeEnabled();
});

test("first sync, gaps, reconnect, duplicate snapshots and rematch obey revision continuity", async ({ page }) => {
  const first = frame(5);
  const wire = await open(page, first);
  const active = page.locator(`${layer} > *`);
  const packets = page.locator(".effect-flight--deal.effect-flight");
  await expect(page.locator(".hand-tile")).toHaveCount(14);
  await expect(active).toHaveCount(0);

  const scored = settled(first, [2]);
  wire.publish(scored);
  await expect(page.locator(".effect-stamp--win")).toHaveCount(1);
  const next = frame(scored.gameRevision + 1, 2);
  wire.publish(next);
  await expect(packets).toHaveCount(4);
  await expect(page.locator(".effect-stamp--win")).toHaveCount(0);
  await seek(page, 203);
  const position = await midpoint(packets.first());
  wire.publish({ ...next, roomRevision: next.roomRevision + 1,
    room: { ...next.room, seats: next.room.seats.map(seat => seat.seat === 1 ? { ...seat, displayName: "Willow II" } : seat) } });
  await expect(page.locator('[data-seat="1"] .seat-name')).toHaveText("Willow II");
  expect(await midpoint(packets.first())).toEqual(position);

  const skipped = { ...settled(frame(next.gameRevision + 3, 4)), roomRevision: next.roomRevision + 4 };
  wire.publish(skipped);
  await expect(page.getByRole("dialog", { name: "Match results" })).toBeVisible();
  await expect(active).toHaveCount(0);
  const rematch = waiting(skipped.gameRevision + 1);
  wire.publish(rematch);
  await expect(page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
  await expect(active).toHaveCount(0);
  const restart = frame(rematch.gameRevision + 1);
  wire.publish(restart);
  await expect(packets).toHaveCount(4);
  await page.setViewportSize({ width: 740, height: 320 });
  await expect(active).toHaveCount(0);

  const recovered = settled(restart);
  wire.reconnect(recovered);
  await expect(page.getByRole("dialog", { name: "Hand results" })).toBeVisible();
  await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
  await expect(active).toHaveCount(0);
  wire.publish(frame(recovered.gameRevision + 1, 2));
  await expect(packets).toHaveCount(4);
});

for (const preference of ["OS", "saved"] as const) {
  test(`${preference} reduced motion keeps immediate rack, call labels and results without ghosts`, async ({ page }) => {
    if (preference === "OS") await page.emulateMedia({ reducedMotion: "reduce" });
    const first = waiting(0);
    const wire = await open(page, first, preference === "saved");
    const started = frame(1);
    wire.publish(started);
    await expect(page.locator(".hand-tile")).toHaveCount(14);
    await expect(page.locator(".hand-tile.is-drawn .draw-mark")).toBeVisible();
    const called = advance(started);
    called.game!.seats[2].melds.push({ kind: "peng", fromSeat: 3, tiles: ["d3", "d3", "d3"] });
    wire.publish(called);
    await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Peng");
    wire.publish(settled(called, [2]));
    await expect(page.getByRole("dialog", { name: "Hand results" })).toBeVisible();
    await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Hu · +8");
    await expect(page.locator(`${layer} > *`)).toHaveCount(0);
  });
}

test("saving reduced motion during a deal interrupts the visible packets", async ({ page }) => {
  const first = waiting(0);
  const wire = await open(page, first);
  await page.route("**/api/profile", route => route.fulfill({
    json: { ...route.request().postDataJSON(), resumeRoomId: first.roomId },
  }));
  const started = frame(1);
  wire.publish(started);
  await expect(page.locator(".effect-flight--deal.effect-flight")).toHaveCount(4);
  await seek(page, 246);
  await page.getByRole("button", { name: "Settings" }).tap();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("checkbox", { name: "Reduce visual motion" }).check();
  await settings.getByRole("button", { name: "Save settings" }).tap();
  await expect(settings.getByText("Settings saved.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator(`${layer} > *`)).toHaveCount(0);
  await settings.getByRole("button", { name: "Close dialog" }).tap();
  await expect(page.getByRole("button", { name: "9 dots, drawn tile" })).toHaveAttribute("aria-disabled", "false");
});

test("pause and visibility interrupt the active cue; no catch-up on return", async ({ page }) => {
  const wire = await open(page, waiting(0));
  const start = frame(1);
  wire.publish(start);
  const active = page.locator(`${layer} > *`);
  await expect(page.locator(".effect-flight--deal.effect-flight")).toHaveCount(4);
  const paused = { ...start, roomRevision: start.roomRevision + 1,
    room: { ...start.room, paused: true, autoResumeAtUtc: new Date(Date.now() + 60000).toISOString() } };
  wire.publish(paused);
  await expect(page.locator(".turn-title")).toHaveText("Table paused");
  await expect(active).toHaveCount(0);
  const resumed = { ...start, roomRevision: paused.roomRevision + 1 };
  wire.publish(resumed);
  await expect(page.locator(".turn-title")).toHaveText("Your turn");
  await expect(active).toHaveCount(0);

  const firstCall = advance(resumed);
  firstCall.game!.seats[1].melds.push({ kind: "chi", fromSeat: 0, tiles: ["b4", "b5", "b6"] });
  wire.publish(firstCall);
  await expect(page.locator(".effect-stamp--chi")).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(active).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const missed = advance(firstCall);
  missed.game!.seats[2].melds.push({ kind: "peng", fromSeat: 1, tiles: ["d3", "d3", "d3"] });
  wire.publish(missed);
  await expect(page.locator('[data-seat="2"] .meld-group')).toHaveCount(1);
  await expect(active).toHaveCount(0);
  const fresh = advance(missed);
  fresh.game!.seats[3].melds.push({ kind: "gang", method: "concealed", fromSeat: null, tiles: [null, null, null, null] });
  wire.publish(fresh);
  await expect(page.locator(".effect-stamp--gang")).toHaveCount(1);
  await page.locator(layer).evaluate(root =>
    root.getAnimations({ subtree: true }).forEach(animation => animation.play()));
  await expect(active).toHaveCount(0);
});

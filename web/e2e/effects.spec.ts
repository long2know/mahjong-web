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
const finale = ".hall-finale";

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

function revealed(prior: Snapshot): Snapshot {
  const state = settled(prior);
  const [chow, closed] = state.game!.settlement!.winners;
  chow.winningHand = {
    concealedTiles: ["b8", "b8", "c4", "c4", "d1", "d1", "d1"],
    melds: [
      { kind: "gang", method: "concealed", fromSeat: null, tiles: ["c9", "c9", "c9", "c9"] },
      { kind: "chi", method: "open", fromSeat: 0, tiles: ["d3", "d4", "d5"] },
    ],
  };
  closed.winningHand = {
    concealedTiles: ["b1", "b1", "b1", "b6", "b7", "c1", "c2", "c3", "d2", "d2", "d7", "d8", "d9"],
    melds: [],
  };
  return state;
}

// Only the transport is stubbed. These frames run through the production session, router, renderer and controls.
async function open(page: Page, initial: Snapshot, savedMotion = false, freezeActors = false) {
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
  }, freezeActors ? `${layer}, .seat-cast` : layer);
  await page.route("**/api/guest", route => route.fulfill({ json: {
    displayName: players[initial.self.seat], resumeRoomId: initial.roomId,
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

const actor = (page: Page, seat: Seat) => page.locator(`[data-actor-seat="${seat}"]`);
const gesture = (page: Page) => page.locator(".seat-actor[data-gesture]");
const joint = (node: Locator, name: string) => node.locator(`[data-joint="${name}"]`);
const eyes = (node: Locator, mood: string) => node.locator(`[data-eyes="${mood}"]`);
const pawPose = (node: Locator, pose: string) => node.locator(`[data-main-paw] [data-hand="${pose}"]`);
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

async function seekCast(page: Page, milliseconds: number) {
  await page.locator(".seat-cast").evaluate((root, time) => {
    for (const animation of root.getAnimations({ subtree: true })) animation.currentTime = time;
  }, milliseconds);
}

async function finishCast(page: Page) {
  await page.locator(".seat-cast").evaluate(root => {
    for (const animation of root.getAnimations({ subtree: true })) animation.finish();
  });
  await expect(gesture(page)).toHaveCount(0);
}

function discardFrom(prior: Snapshot, seat: Seat, face: Face): Snapshot {
  const state = advance(prior);
  const game = state.game!;
  game.seats[seat].discards.push(face);
  game.seats[seat].concealedCount--;
  game.phase = "claim";
  game.turnSeat = null;
  game.window = { ...game.window!, windowId: `discard-${state.gameRevision}`, anchorGameRevision: state.gameRevision,
    reason: "discard", trigger: { seat, faces: [face] } };
  if (seat === state.self.seat) {
    state.self.hand = state.self.hand.filter(tile => tile.tileId !== state.self.drawnTileId);
    state.self.drawnTileId = null;
  }
  state.self.legalOptions = [];
  return state;
}

test("short landscape actors wind up, articulate toward their rivers and settle without moving a tap target", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 320 });
  const initial = frame(17);
  const wire = await open(page, initial, false, true);
  await page.evaluate(() => {
    for (const [edge, inset] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
      document.documentElement.style.setProperty(`--safe-${edge}`, `${inset}px`);
    }
  });
  const cast = page.locator(".seat-cast .seat-actor");
  await expect(cast).toHaveCount(4);
  await expect(page.locator(".seat-cast")).toHaveCSS("pointer-events", "none");
  const stage = (await page.locator(".board-stage").boundingBox())!;
  expect(stage.x).toBeGreaterThanOrEqual(25);
  expect(stage.x + stage.width).toBeLessThanOrEqual(740 - 22);
  for (const seat of seats) {
    const head = (await joint(actor(page, seat), "head").boundingBox())!;
    expect(head.width).toBeGreaterThan(35);
    expect(head.y).toBeGreaterThanOrEqual(stage.y);
    expect(head.y + head.height).toBeLessThanOrEqual(stage.y + stage.height);
  }
  expect(new Set(await cast.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-character")))).size).toBe(4);
  await expect(page.locator(".seat-name")).toHaveText(["You", "Willow", "Ink", "Jade"]);
  await expect(gesture(page)).toHaveCount(0);

  const drawnTile = page.getByRole("button", { name: "9 dots, drawn tile" });
  await drawnTile.tap();
  const confirm = page.getByRole("button", { name: "Discard 9 dots" });
  await expect(confirm).toBeEnabled();
  const near = actor(page, 0), other = actor(page, 1);
  const otherArm = await joint(other, "shoulder").evaluate(node => getComputedStyle(node).transform);
  await page.screenshot({ path: testInfo.outputPath("01-short-seated-before.png") });
  await confirm.tap();
  await expect.poll(() => wire.commands[0]?.op).toBe("choose");
  const tap = await midpoint(confirm);
  await page.touchscreen.tap(tap.x, tap.y);
  expect(wire.commands).toHaveLength(1);
  const first = discardFrom(initial, 0, "d9");
  wire.publish(first, wire.commands[0]);
  await expect(near).toHaveAttribute("data-gesture", "discard");
  await expect(gesture(page)).toHaveCount(1);
  await expect(drawnTile).toHaveCount(0);
  const landing = page.locator(".river--near .last-discard");
  await expect(landing.getByRole("img", { name: "9 dots" })).toBeVisible();
  const target = await midpoint(landing);
  const arm = joint(near, "shoulder"), elbow = joint(near, "elbow"), wrist = joint(near, "wrist");
  const matrix = (node: Locator) => node.evaluate(part => getComputedStyle(part).transform);
  const rest = await midpoint(wrist);
  await seekCast(page, 105);
  const windup = await midpoint(wrist);
  expect(windup.x).toBeLessThan(rest.x - 4);
  await expect(pawPose(near, "open")).toHaveCSS("opacity", "0");
  const prep = await Promise.all([matrix(arm), matrix(elbow), matrix(wrist)]);
  await seekCast(page, 228);
  await seek(page, 228);
  const peak = await midpoint(wrist);
  expect(distance(windup, peak)).toBeGreaterThan(27);
  expect(distance(peak, target)).toBeLessThan(distance(rest, target) - 16);
  const extended = await Promise.all([matrix(arm), matrix(elbow), matrix(wrist)]);
  extended.forEach((value, i) => expect(value).not.toBe(prep[i]));
  await expect(pawPose(near, "open")).toHaveCSS("opacity", "1");
  const hand = (await pawPose(near, "open").boundingBox())!;
  expect(hand.x + hand.width).toBeLessThan(stage.x + stage.width);
  expect(hand.y).toBeGreaterThan(stage.y);
  expect(hand.y + hand.height).toBeLessThan(stage.y + stage.height);
  expect(await matrix(joint(other, "shoulder"))).toBe(otherArm);
  const held = page.getByRole("button", { name: "1 bamboo" });
  const heldBox = await held.boundingBox();
  await page.screenshot({ path: testInfo.outputPath("02-short-seated-reach-228ms.png") });
  await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event("resize")));
  await expect(near).toHaveAttribute("data-gesture", "discard");
  await seekCast(page, 295);
  expect(distance(await midpoint(wrist), peak)).toBeGreaterThan(3);
  expect(await held.boundingBox()).toEqual(heldBox);
  await finishCast(page);
  await seek(page, 510);
  await page.screenshot({ path: testInfo.outputPath("03-short-seated-settled.png") });

  const next = discardFrom(first, 3, "c4");
  wire.publish(next);
  const left = actor(page, 3);
  await expect(left).toHaveAttribute("data-gesture", "discard");
  await expect(gesture(page)).toHaveCount(1);
  const leftWrist = joint(left, "wrist");
  const botRest = await midpoint(leftWrist);
  const leftTarget = await midpoint(page.locator(".river--left .last-discard"));
  await seekCast(page, 228);
  const botPeak = await midpoint(leftWrist);
  expect(botPeak.x).toBeGreaterThan(botRest.x + 12);
  expect(distance(botPeak, leftTarget)).toBeLessThan(distance(botRest, leftTarget) - 9);
});

test("the four reach silhouettes stay on stage beside dense compact rivers", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 320 });
  let state = frame(24);
  state.self.hand = [...hand.slice(0, 4), drawn];
  state.self.legalOptions = state.self.legalOptions.filter(option => state.self.hand.some(tile => tile.tileId === option.tileIds[0]));
  state.game!.seats[0].concealedCount = 5;
  state.game!.seats[0].melds = [
    { kind: "chi", fromSeat: 3, tiles: ["b1", "b2", "b3"] },
    { kind: "peng", fromSeat: 1, tiles: ["c2", "c2", "c2"] },
    { kind: "peng", fromSeat: 2, tiles: ["d3", "d3", "d3"] },
  ];
  for (const seat of state.game!.seats) {
    seat.discards = ["c3", "d2", "b9", "b6", "d5", "c8", "d7", "c5", "b8", "c7", "d4"];
  }
  const wire = await open(page, state, false, true);
  await page.evaluate(() => {
    for (const [edge, inset] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
      document.documentElement.style.setProperty(`--safe-${edge}`, `${inset}px`);
    }
  });
  await expect(page.locator(".local-melds > *")).toHaveCount(3);
  await expect(page.locator(".seat-actor")).toHaveCount(4);
  await page.mouse.click(10, 302);
  const board = (await page.locator(".board-stage").boundingBox())!;
  expect(board.height).toBeLessThan(140);
  for (const seat of seats) {
    state = discardFrom(state, seat, seat === 0 ? drawn.face : "d8");
    wire.publish(state);
    const active = actor(page, seat);
    await expect(active).toHaveAttribute("data-gesture", "discard");
    const wrist = joint(active, "wrist");
    await seekCast(page, 105);
    const wound = await midpoint(wrist);
    await seekCast(page, 228);
    const palm = (await pawPose(active, "open").boundingBox())!;
    expect(distance(wound, await midpoint(wrist)), `seat ${seat} opens away from its folded arm`).toBeGreaterThan(16);
    expect(palm.x).toBeGreaterThanOrEqual(board.x);
    expect(palm.y).toBeGreaterThanOrEqual(board.y);
    expect(palm.x + palm.width).toBeLessThanOrEqual(board.x + board.width);
    expect(palm.y + palm.height).toBeLessThanOrEqual(board.y + board.height);
    if (seat === 3) {
      await seek(page, 228);
      await page.screenshot({ path: testInfo.outputPath("07-dense-seated-reach-228ms.png") });
    }
    await finishCast(page);
  }
});

test("desktop call points and brightens; winning and losing react with different arms and faces", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const initial = frame(26);
  const wire = await open(page, initial, false, true);
  const near = actor(page, 0), far = actor(page, 2), right = actor(page, 1);
  await expect(eyes(far, "open")).toBeVisible();
  const still = await midpoint(joint(far, "wrist"));
  const called = advance(initial);
  called.game!.seats[2].melds.push({ kind: "peng", fromSeat: 3, tiles: ["d3", "d3", "d3"] });
  wire.publish(called);
  await expect(far).toHaveAttribute("data-gesture", "call");
  await expect(gesture(page)).toHaveCount(1);
  await expect(pawPose(far, "point")).toBeVisible();
  await expect(far.locator('[data-mouth="call"]')).toBeVisible();
  await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Peng");
  await expect(page.locator('[data-seat="2"] .meld-group')).toBeVisible();
  await page.getByRole("button", { name: "9 dots, drawn tile" }).tap();
  const target = page.getByRole("button", { name: "Discard 9 dots" });
  const before = await target.boundingBox();
  await seekCast(page, 261);
  await seek(page, 260);
  expect((await midpoint(joint(far, "wrist"))).y).toBeLessThan(still.y - 24);
  expect(await target.boundingBox()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("04-desktop-seat-call-261ms.png") });
  await target.tap();
  await expect.poll(() => wire.commands.length).toBe(1);

  await finishCast(page);
  await expect(far.locator('[data-mouth="rest"]')).toBeVisible();
  wire.publish(settled(called, [1, 2]), wire.commands[0]);
  await expect(right).toHaveAttribute("data-gesture", "win");
  await expect(far).toHaveAttribute("data-gesture", "win");
  await expect(near).toHaveAttribute("data-gesture", "loss");
  await expect(gesture(page)).toHaveCount(3);
  await seekCast(page, 217);
  await seek(page, 217);
  await expect(pawPose(far, "fist")).toBeVisible();
  await expect(pawPose(near, "open")).toBeVisible();
  await expect(eyes(right, "win")).toBeVisible();
  await expect(eyes(near, "loss")).toBeVisible();
  expect((await midpoint(joint(far, "rear-wrist"))).y).toBeLessThan((await midpoint(joint(far, "head"))).y + 3);
  expect((await midpoint(joint(near, "wrist"))).y).toBeGreaterThan((await midpoint(joint(near, "head"))).y + 25);
  const results = page.getByRole("dialog", { name: "Hand results" });
  await expect(results).toBeVisible();
  await results.getByRole("button", { name: "Close dialog" }).tap();
  await page.screenshot({ path: testInfo.outputPath("05-desktop-celebration-and-loss.png") });
  await finishCast(page);
  await expect(eyes(far, "win")).toBeVisible();
  await expect(eyes(near, "loss")).toBeVisible();
  await expect(pawPose(far, "rest")).toBeVisible();
});

test("a cold table chunk catches the first public motion, not a resync", async ({ page }, testInfo) => {
  let release!: () => void, fetched!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { fetched = resolve; });
  await page.route("**/src/actors.css", async route => {
    const response = await route.fetch();
    fetched();
    await wait;
    await route.fulfill({ response });
  });
  const initial = frame(11, 1, false);
  const wire = await open(page, initial, false, true);
  await ready;
  await expect(page.locator(".seat-actor")).toHaveCount(0);
  const discarded = discardFrom(initial, 3, "c4");
  const committed = page.waitForFunction(() => !!document.querySelector(".river--left .last-discard"));
  wire.publish(discarded);
  await committed;
  release();
  await expect(actor(page, 3)).toHaveAttribute("data-gesture", "discard");
  await seekCast(page, 228);
  await seek(page, 228);
  await page.screenshot({ path: testInfo.outputPath("06-portrait-seat-reach-228ms.png") });
  const recovered = settled({ ...discarded, gameRevision: discarded.gameRevision + 2 }, [2]);
  wire.reconnect(recovered);
  await expect(page.getByRole("dialog", { name: "Hand results" })).toBeVisible();
  await expect(gesture(page)).toHaveCount(0);
  await expect(actor(page, 2)).toHaveAttribute("data-mood", "win");
  await expect(eyes(actor(page, 0), "loss")).toBeVisible();
});

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
    { seat: 1, label: "Chow", meld: { kind: "chi", fromSeat: 0, tiles: ["b4", "b5", "b6"] } },
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
    if (meld.kind === "chi") {
      await expect(page.locator('.seat-label[data-seat="1"]').getByRole("group", { name: "Chow · from East" }))
        .toBeVisible();
    }
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
  const right = await midpoint(wins.nth(0)), far = await midpoint(wins.nth(1));
  expect(right.x - far.x).toBeGreaterThan(100);
  expect(right.y - far.y).toBeGreaterThan(15);
  await expect(page.locator(".table-actions").getByText("Hand results", { exact: true })).toBeEnabled();
  await expect(results.getByRole("button", { name: "Next hand" })).toBeEnabled();
});

for (const viewer of seats) {
  test(`seat ${viewer} sees its Chow source to the left and submits the original chi option`, async ({ page }) => {
    const predecessor = ((viewer + 3) % 4) as Seat;
    const successor = ((viewer + 1) % 4) as Seat;
    const baseline = frame(20, 1, false);
    baseline.self.seat = viewer;
    const first = discardFrom(baseline, predecessor, "b8");
    first.self.legalOptions = [{
      optionId: "claim-sequence", kind: "chi", tileIds: [hand[3].tileId, hand[4].tileId], faces: ["b6", "b7", "b8"],
    }, { optionId: "decline", kind: "pass", tileIds: [], faces: [] }];
    const wire = await open(page, first);
    const source = page.locator(`.seat-label--left[data-seat="${predecessor}"]`);
    const nextSeat = page.locator(`.seat-label--right[data-seat="${successor}"]`);
    const own = page.locator(`.seat-label--near[data-seat="${viewer}"]`);
    await expect(source.locator(".seat-name")).toHaveText(players[predecessor]);
    await expect(nextSeat.locator(".seat-name")).toHaveText(players[successor]);
    await expect(own.locator(".seat-name")).toHaveText("You");
    await expect(page.locator(".river--left .last-discard").getByRole("img", { name: "8 bamboo" })).toBeVisible();
    expect((await midpoint(source)).x).toBeLessThan((await midpoint(own)).x - 30);
    const sourceActor = actor(page, predecessor);
    await expect(sourceActor).toHaveAttribute("data-place", "left");
    await expect(actor(page, successor)).toHaveAttribute("data-place", "right");
    expect((await midpoint(sourceActor)).x).toBeLessThan((await midpoint(actor(page, viewer))).x - 20);
    await page.getByRole("button", { name: "Chow: 6 bamboo, 7 bamboo, 8 bamboo" }).tap();
    await expect.poll(() => wire.commands[0]).toMatchObject({ op: "choose", payload: {
      windowId: first.game!.window!.windowId, anchorGameRevision: first.gameRevision, optionId: "claim-sequence",
    } });
    const next = advance(first);
    next.game!.seats[predecessor].discards.pop();
    next.game!.seats[viewer].melds = [{ kind: "chi", fromSeat: predecessor, tiles: ["b6", "b7", "b8"] }];
    next.self.hand = next.self.hand.filter(tile => !first.self.legalOptions[0].tileIds.includes(tile.tileId));
    next.self.legalOptions = [];
    wire.publish(next, wire.commands[0]);
    const chow = page.getByRole("group", { name: `Chow · from ${["East", "South", "West", "North"][predecessor]}` });
    await expect(chow.getByRole("img", { name: "8 bamboo" })).toBeVisible();
    await expect(page.locator(".effect-stamp--chi .effect-caption")).toHaveText("Chow");
    await expect(own.locator(".seat-feedback")).toHaveText("Chow");
  });
}

test("Roll for Kong is offered only for the server's legal Gang", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 320 });
  const first = frame(33);
  first.self.hand = first.self.hand.map((tile, i) => i < 4 ? { ...tile, face: "c8" } : tile);
  const quad = first.self.hand.slice(0, 4);
  first.self.legalOptions = [{ optionId: "supplement-c8", kind: "bu", tileIds: quad.map(tile => tile.tileId), faces: quad.map(tile => tile.face) }];
  const wire = await open(page, first);
  const roll = page.getByRole("button", { name: /^Roll for Kong/ });
  await expect(page.getByRole("button", { name: /^Supplement/ })).toBeVisible();
  await expect(roll).toHaveCount(0);
  const offered = advance(first);
  offered.game!.window = { ...offered.game!.window!, windowId: "legal-kong", anchorGameRevision: offered.gameRevision };
  offered.self.legalOptions = [{ ...offered.self.legalOptions[0], kind: "gang", optionId: "roll-c8" }];
  wire.publish(offered);
  await expect(roll).toBeInViewport({ ratio: 1 });
  await roll.tap();
  await expect.poll(() => wire.commands[0]).toMatchObject({ op: "choose", payload: {
    windowId: "legal-kong", anchorGameRevision: offered.gameRevision, optionId: "roll-c8",
  } });
});

for (const [width, height] of [[1440, 900], [740, 320]] as const) {
  test(`two committed winners light the hall and reveal their actual hands at ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1500));
    const first = discardFrom(frame(40, 1, false), 0, "b8");
    const won = revealed(first);
    first.game!.seats[1].melds = [
      { kind: "gang", method: "concealed", fromSeat: null, tiles: [null, null, null, null] },
      { kind: "chi", fromSeat: 0, tiles: ["d3", "d4", "d5"] },
    ];
    won.game!.seats[1].melds = first.game!.seats[1].melds;
    for (const [i, seat] of won.game!.seats.entries()) {
      seat.discards.unshift(...(["c3", "d2", "b9", "b6", "d5", "c8", "d7"] as Face[]));
      first.game!.seats[i].discards = seat.discards;
    }
    const wire = await open(page, first, false, true);
    if (width === 740) await page.evaluate(() => {
      for (const [edge, inset] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
        document.documentElement.style.setProperty(`--safe-${edge}`, `${inset}px`);
      }
    });
    await expect(page.locator(".seat-actor")).toHaveCount(4);
    await expect(page.locator(".seat-label[data-seat='1'] .tile-back")).toHaveCount(4);
    await expect(page.locator(finale)).toHaveCount(0);
    wire.publish(won);

    const art = page.locator(finale), crest = art.locator(".finale-crest"), relays = art.locator("[data-finale-seat]");
    await expect(relays).toHaveCount(2);
    await expect(art).toHaveAttribute("aria-hidden", "true");
    await expect(art).toHaveCSS("pointer-events", "none");
    await expect(page.locator(".seat-label[data-seat='1'] .seat-feedback")).toHaveText("Hu · +8");
    await expect(page.locator(".seat-label[data-seat='2'] .seat-feedback")).toHaveText("Hu · +8");
    await expect(page.locator(".table-effects .effect-score--loss")).toHaveText("−16");
    const participants = await relays.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-finale-seat")));
    expect(participants).toEqual(["1", "2"]);
    const resultsButton = page.locator(".table-actions").getByRole("button", { name: "Hand results" });
    await expect(resultsButton).toBeEnabled();
    const geometry = () => Promise.all([".board-stage", ".rack", ".table-actions"].map(sel => page.locator(sel).boundingBox()));
    const layout = await geometry();
    const starting = await Promise.all([midpoint(relays.nth(0)), midpoint(relays.nth(1))]);
    for (const [i, seat] of ([1, 2] as const).entries()) {
      const position = await midpoint(actor(page, seat));
      expect(distance(position, starting[i]), `seat ${seat} originates at its actor`).toBeLessThan(width === 740 ? 34 : 62);
    }
    await seekCast(page, 162);
    await seek(page, 162);
    const flying = await Promise.all([midpoint(relays.nth(0)), midpoint(relays.nth(1))]);
    expect(distance(flying[0], starting[0])).toBeGreaterThan(38);
    expect(distance(flying[1], starting[1])).toBeGreaterThan(16);
    await page.screenshot({ path: testInfo.outputPath("01-votives-in-flight-162ms.png") });
    await seekCast(page, 374);
    await seek(page, 374);
    await expect(crest).toHaveCSS("opacity", "1");
    const lantern = await midpoint(crest), bounds = (await crest.boundingBox())!;
    const docked = await Promise.all([midpoint(relays.nth(0)), midpoint(relays.nth(1))]);
    expect(distance(docked[0], lantern)).toBeLessThan(bounds.width * .45);
    expect(distance(docked[1], lantern)).toBeLessThan(bounds.width * .45);
    expect(distance(docked[0], docked[1])).toBeGreaterThan(bounds.width * .30);
    expect(lantern.x).toBeGreaterThan(layout[0]!.x + layout[0]!.width * .5);
    expect(lantern.x).toBeLessThan(layout[0]!.x + layout[0]!.width * .72);
    expect(bounds.width).toBeGreaterThan(width === 740 ? 100 : 200);
    expect(await geometry()).toEqual(layout);
    const buttonPoint = await midpoint(resultsButton);
    expect(await resultsButton.evaluate((node, p) => node.contains(document.elementFromPoint(p.x, p.y)), buttonPoint))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("02-lantern-tableau-374ms.png") });

    wire.publish({ ...won, roomRevision: won.roomRevision + 1,
      room: { ...won.room, seats: won.room.seats.map(seat => seat.seat === 3 ? { ...seat, displayName: "Jade II" } : seat) } });
    await expect(page.locator('.seat-label[data-seat="3"] .seat-name')).toHaveText("Jade II");
    expect(await midpoint(relays.nth(0))).toEqual(docked[0]);
    const results = page.getByRole("dialog", { name: "Hand results" });
    if (width === 740) {
      await resultsButton.focus();
      await page.keyboard.press("Enter");
    } else {
      await page.clock.runFor(539);
      await expect(results).toBeHidden();
      await page.clock.runFor(1);
    }
    await expect(results).toBeVisible();
    await expect(results.getByText("Willow and Ink won this hand.")).toBeVisible();
    await expect(results.getByRole("row", { name: "River (you) -16 -16" })).toHaveCount(1);
    const firstWinner = results.locator(".winner").filter({ hasText: "Willow" });
    const secondWinner = results.locator(".winner").filter({ hasText: "Ink" });
    await expect(firstWinner.getByRole("group", { name: "Concealed tiles" }).getByRole("img")).toHaveCount(7);
    await expect(firstWinner.getByRole("group", { name: "Concealed Kong" }).getByRole("img", { name: "9 characters" }))
      .toHaveCount(4);
    await expect(firstWinner.getByRole("group", { name: "Chow · from East" }).getByRole("img")).toHaveCount(3);
    await expect(firstWinner.getByRole("img", { name: "8 bamboo" })).toHaveCount(3);
    await expect(secondWinner.getByRole("group", { name: "Concealed tiles" }).getByRole("img")).toHaveCount(13);
    for (const winner of [firstWinner, secondWinner]) {
      const event = winner.getByRole("group", { name: "Winning tile" });
      await expect(event.getByRole("img", { name: "8 bamboo" })).toHaveCount(1);
      await expect(event).toHaveCSS("border-top-color", "rgb(218, 172, 101)");
    }
    await expect(results.getByRole("img", { name: "6 dots" })).toHaveCount(0);
    await expect(results.getByRole("img", { name: "Concealed tile" })).toHaveCount(0);
    if (width === 740) await expect(results.locator(".winning-hands")).toBeInViewport({ ratio: .95 });
    expect(await results.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await finishCast(page);
    await expect(art).toHaveCount(0);
    await page.locator(layer).evaluate(root => root.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await page.screenshot({ path: testInfo.outputPath("03-official-winning-hands.png") });
    const next = results.getByRole("button", { name: "Next hand" });
    await next.focus();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => wire.commands[0]?.op).toBe("nextHand");
  });
}

test("settled hands render before deferred art on first sync; that art never catches up", async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/finale.css", async route => {
    await blocked;
    await route.continue();
  });
  const recovered = revealed(frame(61, 4, false));
  await open(page, recovered, false, true);
  const results = page.getByRole("dialog", { name: "Match results" });
  try {
    await expect(results).toBeVisible();
    await expect(results.getByRole("group", { name: "Concealed Kong" }).getByRole("img")).toHaveCount(4);
    await expect(results.getByRole("group", { name: "Winning tile" })).toHaveCount(2);
    await expect(results.getByRole("button", { name: "Rematch" })).toBeEnabled();
    expect(await results.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator(".seat-actor")).toHaveCount(0);
  } finally { release(); }
  await expect(page.locator(".seat-actor")).toHaveCount(4);
  await expect(page.locator(finale)).toHaveCount(0);
  await expect(results.getByRole("group", { name: "Winning tile" })).toHaveCount(2);
});

test("the finale skips draws and releases all effects on visibility loss, reconnect and departure", async ({ page }) => {
  const first = frame(70);
  const wire = await open(page, first, false, true);
  const art = page.locator(finale);
  const results = page.getByRole("dialog", { name: "Hand results" });
  await expect(page.locator(".seat-actor")).toHaveCount(4);
  const draw = settled(first);
  const game = draw.game!;
  game.settlement = { reason: "draw", sourceSeat: null, nextDealerSeat: 0, winners: [], birds: [],
    seatResults: seats.map(seat => ({ seat, delta: 0, total: 0 })) };
  game.seats.forEach(seat => { seat.total = 0; });
  wire.publish(draw);
  await expect(results.getByText("The hand ended in a draw.")).toBeVisible();
  await expect(results.locator(".winning-hands")).toHaveCount(0);
  await expect(art).toHaveCount(0);
  await expect(page.locator(".effect-stamp--win")).toHaveCount(0);

  const turn = async (after: Snapshot, number: number) => {
    const state = frame(after.gameRevision + 1, number);
    wire.publish(state);
    await expect(page.locator(".table-caption")).toHaveText(`Hand ${number} / 4`);
    return state;
  };
  const second = settled(await turn(draw, 2), [3]);
  wire.publish(second);
  await expect(art.locator("[data-finale-seat]")).toHaveAttribute("data-finale-seat", "3");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(art).toHaveCount(0);
  await expect(results).toBeVisible();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const third = revealed(await turn(second, 3));
  wire.publish(third);
  await expect(art.locator("[data-finale-seat]")).toHaveCount(2);
  wire.reconnect(third);
  await expect(art).toHaveCount(0);
  await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
  await expect(results.getByRole("group", { name: "Concealed Kong" }).getByRole("img")).toHaveCount(4);

  const last = settled(await turn(third, 4), [2]);
  wire.publish(last);
  const active = await art.elementHandle();
  const match = page.getByRole("dialog", { name: "Match results" });
  await match.getByRole("button", { name: "Leave table" }).tap();
  await expect.poll(() => wire.commands[0]?.op).toBe("leaveRoom");
  wire.publish(last, wire.commands[0]);
  await expect(page.getByRole("button", { name: "Play with bots" })).toBeVisible();
  expect(await active.evaluate(node => node.parentElement === null && node.getAnimations({ subtree: true }).length === 0)).toBe(true);
});

test("first sync, gaps, reconnect, duplicate snapshots and rematch obey revision continuity", async ({ page }) => {
  const first = frame(5);
  const wire = await open(page, first, false, true);
  const active = page.locator(`${layer} > *`);
  const packets = page.locator(".effect-flight--deal.effect-flight");
  await expect(page.locator(".hand-tile")).toHaveCount(14);
  await expect(page.locator(".seat-actor")).toHaveCount(4);
  await expect(active).toHaveCount(0);

  const scored = settled(first, [2]);
  wire.publish(scored);
  await expect(page.locator(".effect-stamp--win")).toHaveCount(1);
  await expect(page.locator(`${finale} [data-finale-seat]`)).toHaveAttribute("data-finale-seat", "2");
  await page.setViewportSize({ width: 740, height: 320 });
  await expect(page.locator(finale)).toHaveCount(0);
  await expect(page.locator(".seat-label[data-seat='2'] .seat-feedback")).toHaveText("Hu · +8");
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
  await expect(page.locator(finale)).toHaveCount(0);
  const rematch = waiting(skipped.gameRevision + 1);
  wire.publish(rematch);
  await expect(page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
  await expect(active).toHaveCount(0);
  const restart = frame(rematch.gameRevision + 1);
  wire.publish(restart);
  await expect(packets).toHaveCount(4);
  await expect(actor(page, 0)).toHaveAttribute("data-gesture", "gather");
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(active).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);

  const recovered = settled(restart);
  wire.reconnect(recovered);
  await expect(page.getByRole("dialog", { name: "Hand results" })).toBeVisible();
  await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
  await expect(active).toHaveCount(0);
  await expect(page.locator(finale)).toHaveCount(0);
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
    await expect(eyes(actor(page, 0), "open")).toBeVisible();
    await expect(gesture(page)).toHaveCount(0);
    const called = advance(started);
    called.game!.seats[2].melds.push({ kind: "peng", fromSeat: 3, tiles: ["d3", "d3", "d3"] });
    wire.publish(called);
    await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Peng");
    await expect(pawPose(actor(page, 2), "rest")).toBeVisible();
    await expect(gesture(page)).toHaveCount(0);
    wire.publish(settled(called, [2]));
    const results = page.getByRole("dialog", { name: "Hand results" });
    await expect(results).toBeVisible();
    await expect(results.getByRole("group", { name: "Winning tile" }).getByRole("img", { name: "8 bamboo" })).toBeVisible();
    await expect(results.getByRole("group", { name: "Concealed tiles" })).toHaveCount(0);
    await expect(page.locator(finale)).toHaveCount(0);
    await expect(page.locator('[data-seat="2"] .seat-feedback')).toHaveText("Hu · +8");
    await expect(gesture(page)).toHaveCount(0);
    await expect(eyes(actor(page, 2), "win")).toBeVisible();
    await expect(eyes(actor(page, 0), "loss")).toBeVisible();
    await expect(page.locator(`${layer} > *`)).toHaveCount(0);
  });
}

test("saving reduced motion during a deal interrupts the visible packets", async ({ page }) => {
  const first = waiting(0);
  const wire = await open(page, first, false, true);
  await page.route("**/api/profile", route => route.fulfill({
    json: { ...route.request().postDataJSON(), resumeRoomId: first.roomId },
  }));
  await page.evaluate(path => import(path).then(() => {}), "/src/actors.ts");
  const started = frame(1);
  wire.publish(started);
  await expect(page.locator(".effect-flight--deal.effect-flight")).toHaveCount(4);
  await expect(actor(page, 0)).toHaveAttribute("data-gesture", "gather");
  await seek(page, 246);
  await page.getByRole("button", { name: "Settings" }).tap();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("checkbox", { name: "Reduce visual motion" }).check();
  await settings.getByRole("button", { name: "Save settings" }).tap();
  await expect(settings.getByText("Settings saved.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator(`${layer} > *`)).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);
  await settings.getByRole("button", { name: "Close dialog" }).tap();
  await expect(page.getByRole("button", { name: "9 dots, drawn tile" })).toHaveAttribute("aria-disabled", "false");
});

test("pause and visibility interrupt the active cue; no catch-up on return", async ({ page }) => {
  const wire = await open(page, waiting(0), false, true);
  await page.evaluate(path => import(path).then(() => {}), "/src/actors.ts");
  const start = frame(1);
  wire.publish(start);
  const active = page.locator(`${layer} > *`);
  await expect(page.locator(".effect-flight--deal.effect-flight")).toHaveCount(4);
  await expect(actor(page, 0)).toHaveAttribute("data-gesture", "gather");
  const paused = { ...start, roomRevision: start.roomRevision + 1,
    room: { ...start.room, paused: true, autoResumeAtUtc: new Date(Date.now() + 60000).toISOString() } };
  wire.publish(paused);
  await expect(page.locator(".turn-title")).toHaveText("Table paused");
  await expect(active).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);
  const resumed = { ...start, roomRevision: paused.roomRevision + 1 };
  wire.publish(resumed);
  await expect(page.locator(".turn-title")).toHaveText("Your turn");
  await expect(active).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);

  const firstCall = advance(resumed);
  firstCall.game!.seats[1].melds.push({ kind: "chi", fromSeat: 0, tiles: ["b4", "b5", "b6"] });
  wire.publish(firstCall);
  await expect(page.locator(".effect-stamp--chi")).toHaveCount(1);
  await expect(actor(page, 1)).toHaveAttribute("data-gesture", "call");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(active).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const missed = advance(firstCall);
  missed.game!.seats[2].melds.push({ kind: "peng", fromSeat: 1, tiles: ["d3", "d3", "d3"] });
  wire.publish(missed);
  await expect(page.locator('[data-seat="2"] .meld-group')).toHaveCount(1);
  await expect(active).toHaveCount(0);
  await expect(gesture(page)).toHaveCount(0);
  const fresh = advance(missed);
  fresh.game!.seats[3].melds.push({ kind: "gang", method: "concealed", fromSeat: null, tiles: [null, null, null, null] });
  wire.publish(fresh);
  await expect(page.locator(".effect-stamp--gang")).toHaveCount(1);
  await expect(actor(page, 3)).toHaveAttribute("data-gesture", "call");
  await page.locator(layer).evaluate(root =>
    root.getAnimations({ subtree: true }).forEach(animation => animation.play()));
  await expect(active).toHaveCount(0);
});

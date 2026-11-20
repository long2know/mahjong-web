import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { FeedbackWindow } from "./fixtures/geometry";

const fixture = `http://127.0.0.1:${Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179)}/e2e/fixtures/geometry.html`;
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const testInsets = { top: 10, right: 22, bottom: 13, left: 25 };

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))).toEqual({ width: page.viewportSize()!.width, viewport: page.viewportSize()!.width });
}

async function extent(tiles: Locator) {
  return tiles.evaluateAll(nodes => {
    const rects = nodes.map(node => node.getBoundingClientRect());
    const round = (n: number) => Number(n.toFixed(2));
    return {
      count: nodes.length, rows: new Set(rects.map(box => round(box.top))).size,
      bounds: {
        left: round(Math.min(...rects.map(box => box.left))), right: round(Math.max(...rects.map(box => box.right))),
        top: round(Math.min(...rects.map(box => box.top))), bottom: round(Math.max(...rects.map(box => box.bottom))),
      },
    };
  });
}

async function tapEveryEdge(page: Page, locator: Locator, attribute: string, insets = noInsets): Promise<void> {
  const fixtureRoot = page.locator("#fixture");
  let sequence = Number(await fixtureRoot.getAttribute("data-hit-sequence"));
  for (const tile of await locator.all()) {
    const id = (await tile.getAttribute(attribute))!;
    const box = (await tile.boundingBox())!;
    expect(box.width, id).toBeGreaterThanOrEqual(44);
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.x, id).toBeGreaterThanOrEqual(insets.left);
    expect(box.y, id).toBeGreaterThanOrEqual(insets.top);
    expect(box.x + box.width, id).toBeLessThanOrEqual(page.viewportSize()!.width - insets.right);
    expect(box.y + box.height, id).toBeLessThanOrEqual(page.viewportSize()!.height - insets.bottom);
    const offsets = [[2, 2], [box.width - 2, 2], [2, box.height - 2], [box.width - 2, box.height - 2], [box.width / 2, box.height / 2]];
    for (const [dx, dy] of offsets) {
      await page.touchscreen.tap(box.x + dx, box.y + dy);
      await expect.poll(() => fixtureRoot.evaluate(node => ({
        sequence: Number(node.dataset.hitSequence),
        hit: node.dataset.hit, pointer: node.dataset.pointer, discards: node.dataset.discards,
      })), { message: `${id} at ${dx},${dy}`, timeout: 500 })
        .toEqual({ sequence: ++sequence, hit: id, pointer: "touch", discards: "0" });
    }
    if (attribute === "data-tile-id") await expect(tile).toHaveAttribute("aria-pressed", "true");
  }
}

for (const width of [390, 393, 430]) {
  test(`touch corners and centers at ${width}px: 13→14 draw and 18 physical four-kong tiles`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto(fixture);
    const hand = page.locator(".hand-tile");
    await expect(hand).toHaveCount(13);
    const initial = await extent(hand);
    const first = (await hand.first().boundingBox())!;
    const second = (await hand.nth(1).boundingBox())!;
    await page.touchscreen.tap((first.x + first.width + second.x) / 2, first.y + first.height / 2);
    await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "0");
    const adjacent = [await hand.first().getAttribute("data-tile-id"), await hand.nth(1).getAttribute("data-tile-id")];
    expect(["", ...adjacent]).toContain(await page.locator("#fixture").getAttribute("data-hit"));
    const selected = await page.locator(".hand-tile[aria-pressed='true']").all();
    expect(selected.length).toBeLessThanOrEqual(1);
    if (selected[0]) {
      expect(adjacent).toContain(await selected[0].getAttribute("data-tile-id"));
      await selected[0].press("Escape");
    }
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    await tapEveryEdge(page, hand, "data-tile-id");
    const original = await hand.first().elementHandle();
    await page.getByRole("button", { name: "Fixture draw" }).tap();
    await expect(hand).toHaveCount(14);
    expect(await hand.first().evaluate((element, before) => element === before, original)).toBe(true);
    await expect(hand.last()).toHaveAccessibleName("9 dots, drawn tile");
    const drawn = await extent(hand);
    await assertNoHorizontalOverflow(page);
    await tapEveryEdge(page, hand, "data-tile-id");
    await expect(page.getByRole("button", { name: "Discard 9 dots" })).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Discard 9 dots" }).tap();
    await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "1");
    await expect(page.locator("#fixture")).toHaveAttribute("data-chosen", "fixture-draw");

    await page.goto(`${fixture}?kongs`);
    const melds = page.locator("[data-meld-tile]");
    await expect(melds).toHaveCount(16);
    await expect(hand).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Concealed Kong" }).getByRole("img", { name: "Concealed tile" })).toHaveCount(4);
    const added = page.getByRole("group", { name: /Added Kong · from/ });
    const upper = (await added.locator(".stacked").boundingBox())!;
    const lower = (await added.locator(".sourced").boundingBox())!;
    expect(upper.x).toBeCloseTo(lower.x, 0);
    expect(upper.y + upper.height).toBeLessThanOrEqual(lower.y);
    await assertNoHorizontalOverflow(page);
    await tapEveryEdge(page, melds, "data-meld-tile");
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    await tapEveryEdge(page, hand, "data-tile-id");
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("four-kong-fixture-390.png"), fullPage: true });
    await writeFile(testInfo.outputPath("rack-geometry.json"), JSON.stringify({
      browser: browser.version(), viewport: [width, 780], initial, drawn, kongs: await extent(melds), hand: await extent(hand),
    }, null, 2));
  });
}

test("projected plane and real lane taps survive orientation and inset padding", async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${fixture}?insets`);
  const projections: unknown[] = [];
  async function check(width: number, height: number): Promise<void> {
    await assertNoHorizontalOverflow(page);
    const corners = await page.locator("[data-corner]").evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
      const { x, y } = node.getBoundingClientRect();
      return [(node as HTMLElement).dataset.corner!, { x, y }] as const;
    })));
    for (const { x, y } of Object.values(corners)) {
      expect(x).toBeGreaterThan(25);
      expect(x).toBeLessThan(width - 22);
      expect(y).toBeGreaterThan(10);
      expect(y).toBeLessThan(height - 13);
    }
    expect(corners.sw.y).toBeGreaterThan(corners.nw.y + 90);
    const far = corners.ne.x - corners.nw.x;
    const near = corners.se.x - corners.sw.x;
    projections.push({ viewport: [width, height], corners, near, far });
    expect(far).toBeGreaterThan(145);
    expect(near / far).toBeGreaterThan(1.03);
    expect(near / far).toBeLessThan(1.4);
    for (const probe of await page.locator("[data-probe]").all()) {
      const { x, y, width, height } = (await probe.boundingBox())!;
      await page.touchscreen.tap(x + width / 2, y + height / 2);
      await expect(page.locator("#fixture")).toHaveAttribute("data-hit", (await probe.getAttribute("data-probe"))!);
    }
    await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "0");
    await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator(".hand-grid .hand-tile").last()).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Discard tile" })).toBeInViewport({ ratio: 1 });
  }
  await check(360, 800);
  await page.setViewportSize({ width: 800, height: 360 });
  await check(800, 360);
  await page.goto(`${fixture}?insets&kongs`);
  await check(800, 360);
  const melds = page.locator("[data-meld-tile]");
  const hand = page.locator(".hand-tile");
  await expect(melds).toHaveCount(16);
  await expect(hand).toHaveCount(2);
  await tapEveryEdge(page, melds, "data-meld-tile", testInsets);
  await tapEveryEdge(page, hand, "data-tile-id", testInsets);
  const discard = (await page.getByRole("button", { name: "Discard 5 dots", exact: true }).boundingBox())!;
  expect(discard.y + discard.height).toBeLessThanOrEqual(360 - testInsets.bottom);
  await page.screenshot({ path: testInfo.outputPath("four-kong-fixture-landscape.png"), fullPage: true });
  const landscape = {
    browser: browser.version(), insets: testInsets, projections, kongs: await extent(melds), hand: await extent(hand),
  };

  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto(`${fixture}?insets&dealer`);
  await page.getByRole("button", { name: "Fixture draw" }).tap();
  const drawn = page.getByRole("button", { name: "9 characters, drawn tile" });
  const before = (await drawn.boundingBox())!;
  await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
  await expect(drawn).toHaveAttribute("aria-pressed", "true");
  expect(await drawn.boundingBox()).toEqual(before);
  const dealer = { hand: await extent(hand),
    discard: (await page.getByRole("button", { name: "Discard 9 characters" }).boundingBox())! };
  expect(dealer.hand.bounds.bottom).toBeLessThanOrEqual(320 - testInsets.bottom);
  expect(dealer.discard.y + dealer.discard.height).toBeLessThanOrEqual(320 - testInsets.bottom);
  await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "0");

  await page.goto(`${fixture}?insets&kongs`);
  await expect(melds).toHaveCount(16);
  await expect(hand).toHaveCount(2);
  await assertNoHorizontalOverflow(page);
  await tapEveryEdge(page, melds, "data-meld-tile", testInsets);
  await tapEveryEdge(page, hand, "data-tile-id", testInsets);
  const compact = { viewport: [740, 320], kongs: await extent(melds), hand: await extent(hand),
    discard: (await page.getByRole("button", { name: "Discard 5 dots", exact: true }).boundingBox())! };
  expect(compact.discard.y + compact.discard.height).toBeLessThanOrEqual(320 - testInsets.bottom);
  await page.screenshot({ path: testInfo.outputPath("four-kong-fixture-compact.png") });
  await page.touchscreen.tap(compact.discard.x + compact.discard.width / 2, compact.discard.y + compact.discard.height / 2);
  await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "1");
  await expect(page.locator("#fixture")).toHaveAttribute("data-chosen", "fixture-tile-1");

  await writeFile(testInfo.outputPath("plane-geometry.json"), JSON.stringify({ ...landscape, compact, dealer }, null, 2));
});

test("wrapped discard confirmation does not move the compact rack", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 320 });
  await page.goto(`${fixture}?insets&dealer`);
  // Wider glyph spacing reproduces the two-line label seen with the CI runner's fonts.
  await page.addStyleTag({ content: ".discard-confirm { letter-spacing: .12em; word-spacing: .16em; }" });
  await page.getByRole("button", { name: "Fixture draw" }).tap();
  const tile = page.getByRole("button", { name: "9 characters, drawn tile" });
  const confirm = page.getByRole("button", { name: /^Discard / });
  const before = (await tile.boundingBox())!;
  const target = (await confirm.boundingBox())!;

  await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(confirm).toHaveAccessibleName("Discard 9 characters");
  expect(await tile.boundingBox()).toEqual(before);
  expect(await confirm.boundingBox()).toEqual(target);
  expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44);
  expect(target.y + target.height).toBeLessThanOrEqual(320 - testInsets.bottom);
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await assertNoHorizontalOverflow(page);
  expect(await confirm.evaluate(button => {
    const text = document.createRange();
    text.selectNodeContents(button);
    const lines = [...text.getClientRects()];
    const bounds = button.getBoundingClientRect();
    return {
      wraps: new Set(lines.map(line => line.top)).size > 1,
      fits: lines.every(line => line.top >= bounds.top && line.bottom <= bounds.bottom &&
        line.left >= bounds.left && line.right <= bounds.right),
    };
  })).toEqual({ wraps: true, fits: true });

  const fixtureRoot = page.locator("#fixture");
  await expect(fixtureRoot).toHaveAttribute("data-discards", "0");
  await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await expect(fixtureRoot).toHaveAttribute("data-discards", "1");
  await expect(fixtureRoot).toHaveAttribute("data-chosen", "fixture-draw");
});

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function expectSystemMotion(page: Page, reduced: boolean): Promise<void> {
  return expect.poll(() => page.evaluate(query => matchMedia(query).matches, reducedMotionQuery)).toBe(reduced);
}

function settlementStartsMotion(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const animate = Element.prototype.animate;
    let started = false;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
      started ||= this.matches(".seat-feedback");
      return animate.apply(this, args);
    };
    try {
      (window as FeedbackWindow).feedbackFixture.paint("settle");
      return started || [...document.querySelectorAll(".seat-feedback")].some(badge =>
        badge.getAnimations().some(animation => animation.playState !== "idle"));
    } finally {
      Element.prototype.animate = animate;
    }
  });
}

test("committed feedback follows the right river, calls and scores without replaying on sync", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 360 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${fixture}?insets&feedback`);
  const river = page.locator(".river--right");
  for (const kind of ["discard", "seabed", "cannon"] as const) {
    await page.evaluate(frame => {
      const { paint } = (window as FeedbackWindow).feedbackFixture;
      paint("base", false);
      paint(frame);
    }, kind);
    await expect(river.locator(".last-discard").getByRole("img", { name: "7 dots" })).toHaveCount(1);
    await expect(page.locator(".last-discard")).toHaveCount(1);
  }
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("rob", false));
  await expect(page.locator(".center-trigger").getByRole("img", { name: "7 dots" })).toBeVisible();
  await expect(page.locator(".last-discard")).toHaveCount(0);

  const motion = await page.evaluate(() => {
    const { paint } = (window as FeedbackWindow).feedbackFixture;
    paint("draw");
    const drawn = document.querySelector(".hand-tile.is-drawn .tile-face")!;
    const flight = drawn.getAnimations()[0];
    paint("cannon");
    const discard = document.querySelector(".last-discard .tile-face")!.getAnimations()[0];
    return { drawerAnimated: !!flight, replaced: flight?.playState, riverAnimated: !!discard };
  });
  expect(motion).toEqual({ drawerAnimated: true, replaced: "idle", riverAnimated: true });

  const caller = page.locator('.seat-label[data-seat="2"]');
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("call"));
  await expect(caller.locator(".seat-feedback")).toHaveText("Peng");
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.interrupt());
  await expect(caller.locator(".seat-feedback")).toBeHidden();
  await expect(caller.getByRole("group", { name: /Peng/ })).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectSystemMotion(page, true);
  expect(await settlementStartsMotion(page)).toBe(false);
  await expect(caller.locator(".seat-feedback")).toHaveText("Hu · +8");
  await expect(page.locator('.seat-label[data-seat="0"] .seat-feedback')).toHaveText("−8");
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("base", false));
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("call", false));
  await expect(caller.getByRole("group", { name: /Peng/ })).toHaveCount(1);
  await expect(caller.locator(".seat-feedback")).toBeHidden();
});

test("settlement follows initial OS motion settings and changes to saved preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${fixture}?feedback`);
  await expectSystemMotion(page, true);
  expect(await settlementStartsMotion(page)).toBe(false);
  await expect(page.locator('.seat-label[data-seat="2"] .seat-feedback')).toHaveText("Hu · +8");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectSystemMotion(page, false);
  for (const reduced of [false, true, false]) {
    await page.evaluate(reduced => {
      document.documentElement.dataset.reducedMotion = String(reduced);
      (window as FeedbackWindow).feedbackFixture.paint("base", false);
    }, reduced);
    expect(await settlementStartsMotion(page), `saved reduced motion: ${reduced}`).toBe(!reduced);
  }
});

type AudioTrace = {
  starts: { id: number; noise: boolean }[];
  stops: { id: number; when: number }[];
};
type AudioWindow = FeedbackWindow & { fixtureAudio: AudioTrace; webkitAudioContext?: typeof AudioContext };

test("original tile and call cues obey unlock, replacement and mute", async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as AudioWindow;
    const trace: AudioTrace = { starts: [], stops: [] };
    scope.fixtureAudio = trace;
    const context = (scope.AudioContext ?? scope.webkitAudioContext)!.prototype;
    let serial = 0;
    for (const method of ["createOscillator", "createBufferSource"] as const) {
      const original: (this: AudioContext) => AudioScheduledSourceNode = context[method];
      Object.defineProperty(context, method, { configurable: true, value(this: AudioContext) {
        const node = original.call(this);
        const id = serial++;
        const start = node.start.bind(node);
        const stop = node.stop.bind(node);
        node.start = (when?: number) => {
          trace.starts.push({ id, noise: method === "createBufferSource" });
          start(when);
        };
        node.stop = (when = 0) => {
          trace.stops.push({ id, when });
          stop(when);
        };
        return node;
      } });
    }
  });
  await page.goto(`${fixture}?feedback&audio`);
  const locked = await page.evaluate(() => {
    const { paint } = (window as AudioWindow).feedbackFixture;
    paint("discard");
    return (window as AudioWindow).fixtureAudio.starts.length;
  });
  expect(locked).toBe(0);
  await page.getByRole("button", { name: "Enable fixture sound" }).tap();
  await expect.poll(() => page.evaluate(() => (window as AudioWindow).feedbackFixture.audioReady())).toBe(true);

  const playback = await page.evaluate(() => {
    const { feedbackFixture: audio, fixtureAudio: trace } = window as AudioWindow;
    audio.paint("base", false);
    audio.paint("discard");
    const strike = trace.starts.slice();
    const before = trace.stops.slice();
    audio.paint("call");
    const call = trace.starts.slice(strike.length);
    const replaced = before.some(voice => trace.stops.slice(before.length).some(next => next.id === voice.id && next.when < voice.when));
    const starts = trace.starts.length;
    audio.mute();
    audio.paint("settle");
    return { strike, call, replaced, afterMute: trace.starts.length - starts };
  });
  expect(playback.strike.some(voice => voice.noise)).toBe(true);
  expect(playback.strike.some(voice => !voice.noise)).toBe(true);
  expect(playback.call.filter(voice => voice.noise).length).toBeGreaterThan(playback.strike.filter(voice => voice.noise).length);
  expect(playback.replaced).toBe(true);
  expect(playback.afterMute).toBe(0);
});

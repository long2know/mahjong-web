import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Snapshot } from "../src/protocol";
import type { FeedbackWindow } from "./fixtures/geometry";

const fixture = `http://127.0.0.1:${Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179)}/e2e/fixtures/geometry.html`;
const sizes = [[1440, 900], [740, 320], [390, 780]] as const;
const targets = ".hand-tile, .discard-confirm, .pause-btn, [data-probe]";
const tableParts = ".board-stage, .board-plane, .board-well, [data-corner], .seat-label, .seat-actor, .rack, .table-actions";

function measure(page: Page) {
  return page.evaluate(({ targets, tableParts }) => {
    const root = document.documentElement;
    const box = (node: Element) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const controls = Array.from(document.querySelectorAll(targets), node => {
      const bounds = box(node);
      const { x, y, width, height } = bounds;
      const points = [[2, 2], [width - 2, 2], [2, height - 2], [width - 2, height - 2], [width / 2, height / 2]];
      return {
        bounds,
        hit: points.map(([left, top]) => document.elementFromPoint(x + left, y + top)?.closest(targets) === node),
      };
    });
    const plane = box(document.querySelector(".board-plane")!);
    return {
      plane, controls,
      parts: Array.from(document.querySelectorAll(tableParts), box),
      viewport: [root.scrollWidth, root.scrollHeight, scrollX, scrollY],
    };
  }, { targets, tableParts });
}

test.use({ reducedMotion: "reduce" });

for (const [width, height] of sizes) {
  test(`Hall paint stays clear of stationary targets at ${width}×${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${fixture}?dealer${width === 740 ? "&insets" : ""}`);
    await page.getByRole("button", { name: "Fixture draw" }).tap();
    await expect(page.locator(".seat-actor")).toHaveCount(4);
    const sheet = page.locator('style[data-vite-dev-id$="/hall.css"]');
    await expect(sheet).toHaveCount(1);
    const backdrop = () => page.evaluate(() => {
      const room = getComputedStyle(document.body, "::before");
      return { illustrated: room.backgroundImage.includes("url("), pointer: room.pointerEvents };
    });
    const paint = await backdrop();
    expect(paint).toEqual({ illustrated: true, pointer: "none" });
    const theater = await measure(page);
    const names = await page.getByRole("region", { name: "Mahjong table" }).ariaSnapshot();
    const { plane } = theater;
    const capture = async (label: string) => {
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`${label}.png`) });
      return {
        room: await page.screenshot({ clip: { x: 0, y: 0, width, height: Math.floor(plane.y) } }),
        felt: await page.screenshot({ clip: {
          x: Math.floor(plane.x + plane.width * .23), y: Math.floor(plane.y + plane.height * .27),
          width: Math.floor(plane.width * .54), height: Math.floor(plane.height * .42),
        } }),
      };
    };
    const after = await capture("after");

    await sheet.evaluate(style => { (style as HTMLStyleElement).sheet!.disabled = true; });
    expect((await backdrop()).illustrated).toBe(false);
    expect(await measure(page)).toEqual(theater);
    expect(await page.getByRole("region", { name: "Mahjong table" }).ariaSnapshot()).toEqual(names);
    const before = await capture("before");
    await sheet.evaluate(style => { (style as HTMLStyleElement).sheet!.disabled = false; });
    expect(before.room.equals(after.room), "room paint outside the table").toBe(false);
    expect(before.felt.equals(after.felt), "paint on the central felt").toBe(false);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = "true"; });
    expect(await backdrop()).toEqual(paint);
    expect(theater.viewport).toEqual([width, height, 0, 0]);
    const rack = page.getByRole("button", { name: "9 characters, drawn tile" });
    const box = (await rack.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(box.x + box.width - 2, box.y + 2);
    await expect(rack).toHaveAttribute("aria-pressed", "true");
    expect(await rack.boundingBox()).toEqual(box);
    const check = page.getByRole("button", { name: "Discard 9 characters" });
    await expect(check).toBeInViewport({ ratio: 1 });
    const probe = page.getByRole("button", { name: "Fixture right plane probe" });
    await probe.tap();
    await expect(page.locator("#fixture")).toHaveAttribute("data-hit", "right");
    await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "0");
    expect((await measure(page)).viewport).toEqual(theater.viewport);
  });
}

type DialWindow = typeof window & {
  dialTest: {
    paint: (id: string, dice: [number, number] | null, motion: boolean, paused?: boolean) => [number, number];
    clear: () => void;
  };
};

test("the passive Hall dial paints server dice once per roll and keeps them when motion clears", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 320 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${fixture}?dealer&insets&feedback`);
  await expect(page.locator(".seat-actor")).toHaveCount(4);
  await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("cannon", false));
  const moduleUrl = new URL("/src/dial.ts", fixture).href;
  const center = page.locator(".board-center");
  await page.evaluate(async url => {
    const { HallDial }: typeof import("../src/dial") = await import(url);
    const live = document.querySelector<HTMLElement>(".board-center")!;
    const center = live.cloneNode(true) as HTMLElement;
    center.querySelectorAll(".hall-dial-plate, .hall-dial-roll, .sr-only").forEach(node => node.remove());
    live.replaceWith(center);
    const dial = new HallDial(center);
    let started = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.classList.contains("hall-dial-die")) {
        started++;
        animation.pause();
      }
      return animation;
    };
    (window as DialWindow).dialTest = {
      paint: (id, dice, motion, paused = false) => {
        dial.present({
          roomId: "dial-test", room: { paused }, self: { seat: 0 }, game: {
            handNumber: 1, dealerSeat: 0, turnSeat: 1, window: { windowId: id },
            ...(dice && { kongRoll: { seat: 1, dice, lowerDie: Math.min(...dice) } }),
          },
        } as Snapshot, motion);
        return [started, center.getAnimations({ subtree: true }).length];
      },
      clear: () => dial.clear(),
    };
  }, moduleUrl);
  const paint = (id: string, dice: [number, number] | null, motion: boolean, paused = false) =>
    page.evaluate(({ id, dice, motion, paused }) => (window as DialWindow).dialTest.paint(id, dice, motion, paused),
      { id, dice, motion, paused });
  expect(await paint("before", null, false)).toEqual([0, 0]);
  const roll = center.locator(".hall-dial-roll");
  await expect(roll).toBeHidden();
  await expect(page.getByRole("button", { name: "Roll for Kong" })).toHaveCount(0);
  await expect(center.locator(".wall-count")).toHaveText("48");
  await expect(center.locator(".center-trigger").getByRole("img", { name: "7 dots" })).toBeVisible();
  const plate = center.locator(".hall-dial-plate");
  await expect(plate).toHaveCSS("pointer-events", "none");
  await expect(plate.locator(".hall-dial-wind[data-lit]")).toHaveText("S");
  const side = await plate.getAttribute("data-lit");
  await expect(page.locator(`.seat-label--${side} .seat-wind`)).toHaveText("S");
  expect(await page.locator(".river li").evaluateAll(tiles => tiles.every(tile => {
    const { x, y, width, height } = tile.getBoundingClientRect();
    return !document.elementFromPoint(x + width / 2, y + height / 2)?.closest(".board-center");
  }))).toBe(true);

  expect(await paint("synced", [2, 5], false)).toEqual([0, 0]);
  await expect(roll).toBeVisible();
  await expect(roll.locator("svg").first().locator("circle")).toHaveCount(2);
  await expect(roll.locator("svg").last().locator("circle")).toHaveCount(5);
  await expect(roll).toHaveText("Low 2");
  await expect(center.locator(".sr-only")).toHaveText("Kong roll: 2 and 5. Lower die: 2.");
  expect(await paint("new-window", [2, 5], true)).toEqual([2, 2]);
  expect(await paint("new-window", [2, 5], false)).toEqual([2, 2]);
  await page.evaluate(() => (window as DialWindow).dialTest.clear());
  expect(await paint("new-window", [2, 5], true)).toEqual([2, 0]);
  await page.screenshot({ path: testInfo.outputPath("dial-740x320.png"), animations: "disabled" });

  expect(await paint("paused", [3, 6], true, true)).toEqual([2, 0]);
  await expect(roll).toHaveText("Low 3");
  await page.evaluate(() => { document.documentElement.dataset.reducedMotion = "true"; });
  expect(await paint("reduced", [1, 6], true)).toEqual([2, 0]);
  await expect(roll).toHaveText("Low 1");
  expect(await paint("expired", null, false)).toEqual([2, 0]);
  await expect(roll).toBeHidden();
});

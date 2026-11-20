import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

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
  await writeFile(testInfo.outputPath("plane-geometry.json"), JSON.stringify({
    browser: browser.version(), insets: testInsets, projections, kongs: await extent(melds), hand: await extent(hand),
  }, null, 2));
});

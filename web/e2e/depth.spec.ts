import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { FeedbackWindow } from "./fixtures/geometry";

const fixture = `http://127.0.0.1:${Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179)}/e2e/fixtures/geometry.html`;
const lanes = ["near", "far", "left", "right"] as const;
type Bounds = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

function measure(page: Page) {
  return page.evaluate(names => {
    const box = (selector: string) => {
      const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    return {
      rivers: names.map(lane => ({
        footprint: box(`.river--${lane} li:first-child .tile-target`),
        top: box(`.river--${lane} li:first-child .tile-face`),
      })),
      wall: box(".wall--near span"),
      hand: box(".hand-tile"),
    };
  }, lanes);
}

function around({ left, right, top, bottom }: Bounds, margin: number): Bounds {
  return { left: left - margin, right: right + margin, top: top - margin, bottom: bottom + margin };
}

async function paintedPanels(page: Page, regions: Bounds[]) {
  const screenshot = () => page.screenshot({ scale: "css", animations: "disabled" });
  const solid = await screenshot();
  const without = async (selectors: string) => {
    const hide = await page.addStyleTag({ content: `${selectors} { visibility: hidden !important; }` });
    const control = await screenshot();
    await hide.evaluate(node => node.parentNode?.removeChild(node));
    return control.toString("base64");
  };
  // Change only the selected facets. Use a search margin because headless WebKit's
  // raster projection can be slightly sheared relative to its reported DOM bounds.
  const fronts = await without(`
    :is(.river--near, .river--far) li:first-child .tile-target::after,
    :is(.river--left, .river--right) li:first-child .tile-target::before,
    .wall--near span:first-child::after
  `);
  const side = await without(".river--near li:first-child .tile-target::before");
  return page.evaluate(async ({ regions, solid, fronts, side }) => {
    const pixels = async (data: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    };
    const [painted, noFront, noSide] = await Promise.all([pixels(solid), pixels(fronts), pixels(side)]);
    return regions.map(({ left, top, right, bottom }, region) => {
      const control = region < regions.length - 1 ? noFront : noSide;
      let changed = 0;
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(painted.height, bottom); y++) {
        for (let x = Math.max(0, Math.floor(left)); x < Math.min(painted.width, right); x++) {
          const i = (y * painted.width + x) * 4;
          const contrast = [0, 1, 2].reduce((sum, c) => sum + Math.abs(painted.data[i + c] - control.data[i + c]), 0);
          if (contrast > 45) changed++;
        }
      }
      return changed;
    });
  }, { regions, solid: solid.toString("base64"), fronts, side });
}

test.use({ reducedMotion: "reduce" });

for (const [width, height] of [[1440, 900], [740, 320]] as const) {
  test(`resting discard bodies and wall paint against their feet at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${fixture}?feedback${width === 740 ? "&insets" : ""}`);
    await page.evaluate(() => (window as FeedbackWindow).feedbackFixture.paint("discard", false));
    await expect(page.locator(".last-discard").getByRole("img", { name: "7 dots" })).toHaveCount(1);
    await expect(page.locator(".wall-count")).toHaveText("48");
    for (const lane of lanes) {
      await expect(page.locator(`.river--${lane} li:first-child`).getByRole("img")).toHaveAccessibleName("1 dots");
    }

    const standing = await measure(page);
    // Collapse the same rendered tiles to tabletop level without changing the table or hitboxes.
    const collapse = await page.addStyleTag({ content: ".river, .wall { --height: 0px !important; }" });
    const flat = await measure(page);
    await collapse.evaluate(node => node.parentNode?.removeChild(node));
    expect(standing.hand).toEqual(flat.hand);
    for (const [i, lane] of lanes.entries()) {
      const raised = standing.rivers[i], foot = flat.rivers[i];
      expect(raised.footprint, `${lane} hit area`).toEqual(foot.footprint);
      expect(foot.top.bottom - raised.top.bottom, `${lane} lift`).toBeGreaterThan(width === 740 ? 3 : 5);
    }
    expect(flat.wall.bottom - standing.wall.bottom, "stacked wall lift").toBeGreaterThan(3);
    expect(flat.rivers[0].top.right - standing.rivers[0].top.right, "near side separation")
      .toBeGreaterThan(width === 740 ? 1 : 2);

    const areas = [...flat.rivers.map(river => river.footprint), flat.wall, flat.rivers[0].footprint];
    const patches = await paintedPanels(page, areas.map(area => around(area, width === 740 ? 13 : 52)));
    for (const [i, label] of [...lanes, "wall front", "near side"].entries()) {
      expect(patches[i], `${label} visible body pixels`).toBeGreaterThanOrEqual(width === 740 ? 9 : 32);
    }
  });
}

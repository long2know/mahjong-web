import { expect, test } from "@playwright/test";
import type { Face } from "../src/protocol";

const origin = `http://127.0.0.1:${Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179)}`;
const fixture = `${origin}/e2e/fixtures/geometry.html`;
const sizes = [[1280, 720], [1440, 900], [1920, 1080]] as const;

test.use({ isMobile: false, hasTouch: false, reducedMotion: "reduce" });

test("the desktop table fills the viewport without pushing the hand or confirm control out", async ({ page }, testInfo) => {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.goto(fixture);
    await page.getByRole("button", { name: "Fixture draw" }).click();
    const hand = page.locator(".hand-tile");
    const drawn = page.getByRole("button", { name: "9 dots, drawn tile" });
    const before = await drawn.boundingBox();
    await hand.first().press("End");
    await expect(drawn).toBeFocused();
    await drawn.press("Enter");
    await expect(drawn).toHaveAttribute("aria-pressed", "true");
    expect(await drawn.boundingBox()).toEqual(before);
    expect(await page.locator("#fixture").getAttribute("data-discards")).toBe("0");

    const desk = await page.evaluate(() => {
      const rect = (node: Element) => node.getBoundingClientRect().toJSON() as DOMRect;
      const bounds = (selector: string) => rect(document.querySelector(selector)!);
      const boxes = (selector: string) => [...document.querySelectorAll(selector)].map(rect);
      const corners = Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-corner]")].map(node =>
        [node.dataset.corner!, rect(node)] as const));
      return {
        root: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        corners, stage: bounds(".board-stage"), plane: bounds(".board-plane"), rack: bounds(".rack"),
        confirm: bounds(".discard-confirm"), hand: boxes(".hand-tile"), chairs: boxes(".seat-label"),
        nearArt: bounds(".river--near .tile-art"), sideArt: bounds(".river--left .tile-art"),
        handArt: bounds(".hand-tile .tile-art"), wall: bounds(".wall--left span"),
      };
    });
    expect(desk.root).toEqual([width, height]);
    expect(desk.plane.width).toBeGreaterThanOrEqual(.8 * width);
    expect(desk.stage.height).toBeGreaterThan(.6 * height);
    expect(desk.plane.bottom).toBeLessThan(desk.rack.top);
    const far = desk.corners.ne.x - desk.corners.nw.x;
    const near = desk.corners.se.x - desk.corners.sw.x;
    expect(near / far).toBeGreaterThan(1.05);
    expect(near / far).toBeLessThan(1.25);
    for (const corner of Object.values(desk.corners)) {
      expect(corner.x).toBeGreaterThan(desk.stage.left);
      expect(corner.x).toBeLessThan(desk.stage.right);
      expect(corner.y).toBeGreaterThan(desk.stage.top);
      expect(corner.y).toBeLessThan(desk.stage.bottom);
    }
    expect(desk.chairs).toHaveLength(4);
    for (const chair of desk.chairs) {
      expect(chair.left).toBeGreaterThanOrEqual(desk.stage.left);
      expect(chair.right).toBeLessThanOrEqual(desk.stage.right);
      expect(chair.top).toBeGreaterThanOrEqual(desk.stage.top);
      expect(chair.bottom).toBeLessThanOrEqual(desk.stage.bottom);
    }
    expect(desk.hand).toHaveLength(14);
    for (const tile of desk.hand) {
      expect(tile.top).toBeCloseTo(desk.hand[0].top);
      expect(tile.width).toBeGreaterThanOrEqual(44);
      expect(tile.height).toBeGreaterThanOrEqual(44);
      expect(tile.bottom).toBeLessThanOrEqual(desk.rack.bottom);
    }
    for (const art of [desk.nearArt, desk.sideArt]) {
      expect(Math.min(art.width, art.height)).toBeGreaterThanOrEqual(18);
    }
    expect(desk.handArt.width).toBeGreaterThanOrEqual(44);
    expect(Math.min(desk.wall.width, desk.wall.height)).toBeGreaterThanOrEqual(12);
    expect(desk.confirm.height).toBeGreaterThanOrEqual(44);
    expect(desk.confirm.width).toBeGreaterThanOrEqual(44);
    const confirm = page.getByRole("button", { name: "Discard 9 dots" });
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`table-${width}x${height}.png`) });
    await confirm.press("Enter");
    await expect(page.locator("#fixture")).toHaveAttribute("data-discards", "1");
    await expect(page.locator("#fixture")).toHaveAttribute("data-chosen", "fixture-draw");
  }
});

test("all 27 suited tiles paint from one passive local sheet requested only at the table", async ({ page }, testInfo) => {
  const outside: string[] = [];
  const sheets = new Set<string>();
  const faceUse = ".tile-art use";
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      outside.push(url.href);
      return route.abort();
    }
    if (url.pathname.endsWith("/tile-suits.svg")) sheets.add(url.pathname);
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  expect((await page.locator(".shell").boundingBox())!.width).toBe(1120);
  await expect(page.locator(".sample-tiles .tile-back")).toHaveCount(3);
  expect([...sheets]).toEqual([]);
  const painted = (selector: string) => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const { width, height } = (node as SVGGraphicsElement).getBBox();
    return width >= 70 && height >= 100;
  }));
  const faces = ["b", "c", "d"].flatMap(suit => Array.from({ length: 9 }, (_, i) => `${suit}${i + 1}` as Face));
  await page.evaluate(async ({ faces, moduleUrl }) => {
    const { tileLabel }: typeof import("../src/tile") = await import(moduleUrl);
    const gallery = document.createElement("section");
    gallery.id = "face-gallery";
    gallery.style.cssText = "display:grid;grid-template-columns:repeat(9,65px);gap:8px;justify-content:center;padding:20px";
    for (const face of faces) {
      const tile = tileLabel(face);
      tile.style.cssText = "width:65px;height:81px";
      gallery.append(tile);
    }
    document.body.replaceChildren(gallery);
  }, { faces, moduleUrl: `${origin}/src/tile.ts` });
  await expect(page.getByRole("img", { name: "1 bamboo" })).toHaveCount(1);
  await expect(page.getByRole("img", { name: "9 dots" })).toHaveCount(1);
  const allArtwork = `#face-gallery ${faceUse}`;
  await expect.poll(() => painted(allArtwork)).toEqual(faces.map(() => true));
  const hrefs = await page.locator(allArtwork).evaluateAll(nodes => nodes.map(node => node.getAttribute("href")!));
  expect(hrefs.map(href => new URL(href).hash)).toEqual(faces.map(face => `#lt-${face}`));
  const assetUrls = Array.from(new Set(hrefs.map(href => href.split("#")[0])));
  expect(assetUrls).toHaveLength(1);
  expect([...sheets]).toEqual([new URL(assetUrls[0]).pathname]);
  const inventory = await page.evaluate(async urls => {
    const svgNS = "http://www.w3.org/2000/svg";
    const shapes = new Set(["svg", "defs", "symbol", "g", "path", "circle", "ellipse", "rect", "use"]);
    const attributes = new Set(["xmlns", "id", "viewBox", "transform", "d", "cx", "cy", "r", "rx", "ry", "x", "y",
      "width", "height", "href", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
      "stroke-linejoin", "stroke-dasharray"]);
    const symbols: string[] = [];
    const invalid: string[] = [];
    for (const url of urls) {
      if (new URL(url).origin !== location.origin) {
        invalid.push(url);
        continue;
      }
      const response = await fetch(url);
      const source = await response.text();
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      if (!response.ok || doc.documentElement.localName !== "svg" || /<!|url\s*\(/i.test(source)) invalid.push(url);
      const ids = new Set<string>();
      const links: string[] = [];
      for (const node of doc.querySelectorAll("*")) {
        if (node.namespaceURI !== svgNS || !shapes.has(node.localName)) invalid.push(node.localName);
        if (node.id) {
          if (!/^lt-[a-z0-9-]+$/.test(node.id) || ids.has(node.id)) invalid.push(node.id);
          ids.add(node.id);
        }
        if (node.localName === "symbol") symbols.push(node.id);
        for (const attr of node.attributes) {
          if (!attributes.has(attr.name) || /(?:javascript:|data:|https?:|\/\/)/i.test(attr.value) && attr.name !== "xmlns") {
            invalid.push(`${node.localName}.${attr.name}`);
          }
          if (attr.name === "href") links.push(attr.value);
        }
      }
      for (const link of links) {
        if (!link.startsWith("#") || !ids.has(link.slice(1))) invalid.push(link);
      }
    }
    return { symbols: symbols.sort(), invalid };
  }, assetUrls);
  expect(inventory.invalid).toEqual([]);
  expect(inventory.symbols).toEqual(faces.map(face => `lt-${face}`));
  expect(outside).toEqual([]);
  await page.locator("#face-gallery").screenshot({ path: testInfo.outputPath("traditional-suited-faces.png") });
});

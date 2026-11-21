import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { ClientMessage, Seat, Snapshot, Tile } from "../src/protocol";

const origin = `http://127.0.0.1:${Number(process.env.MAHJONG_GEOMETRY_PORT ?? 4179)}`;
type ScreenFixture = typeof window & {
  screenMode: {
    calls: { mode: string; trusted: boolean; receiver: boolean }[];
    change: (active: boolean, notify?: boolean) => void;
    finish: (ok: boolean) => void;
  };
};

async function fullscreenFixture(page: Page, supported: boolean) {
  await page.evaluate(enabled => {
    let active = false;
    let trusted = false;
    let complete: ((ok: boolean) => void) | undefined;
    const calls: ScreenFixture["screenMode"]["calls"] = [];
    window.addEventListener("click", event => { trusted = event.isTrusted; }, { capture: true });
    window.addEventListener("click", () => { trusted = false; });
    const change = (next: boolean, notify = true) => {
      active = next;
      if (notify) document.dispatchEvent(new Event("fullscreenchange"));
    };
    const call = (mode: string, receiver: boolean) => {
      calls.push({ mode, trusted, receiver });
      return new Promise<void>((resolve, reject) => {
        complete = ok => ok ? resolve() : reject(new DOMException("Display denied", "NotAllowedError"));
      });
    };
    Object.defineProperties(document, {
      fullscreenEnabled: { get: () => enabled },
      fullscreenElement: { get: () => active ? document.documentElement : null },
      exitFullscreen: { value() { return call("exit", this === document); } },
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      value() { return call("enter", this === document.documentElement); },
    });
    (window as ScreenFixture).screenMode = { calls, change, finish: ok => complete?.(ok) };
  }, supported);
}

async function openTable(page: Page) {
  const seats: Seat[] = [0, 1, 2, 3];
  const hand: Tile[] = Array.from({ length: 14 }, (_, index) => ({ tileId: `held-${index}`, face: "d9" }));
  const now = new Date();
  const state: Snapshot = {
    v: 1, type: "snapshot", roomId: "fullscreen-table", roomRevision: 1, gameRevision: 1,
    serverTimeUtc: now.toISOString(),
    room: { visibility: "invite", status: "playing", hostSeat: 0, matchHands: 1, paused: false,
      autoResumeAtUtc: null, rulesVersion: "changsha-v1", chat: [], seats: seats.map(seat => ({
        seat, ready: true, connected: true, kind: seat === 0 ? "human" : "bot", displayName: `Seat ${seat + 1}`,
      })) },
    game: { handNumber: 1, dealerSeat: 0, phase: "turn", turnSeat: 0, wallCount: 55, settlement: null,
      seats: seats.map(seat => ({ seat, concealedCount: seat === 0 ? hand.length : 13,
        discards: [], melds: [], revealedTiles: [], total: 0 })),
      window: { windowId: "turn", anchorGameRevision: 1, reason: "turn", trigger: null,
        deadlineUtc: new Date(now.getTime() + 120000).toISOString() } },
    self: { seat: 0, inviteCode: null, hand, drawnTileId: hand.at(-1)!.tileId,
      legalOptions: hand.map(({ tileId, face }) => ({ optionId: `drop-${tileId}`, kind: "discard", tileIds: [tileId], faces: [face] })) },
  };
  await page.route("**/api/guest", route => route.fulfill({ json: {
    displayName: "Seat 1", resumeRoomId: state.roomId,
    preferences: { sound: false, music: false, volume: .7, reducedMotion: true },
  } }));
  await page.route("**/api/rooms", route => route.fulfill({ json: { rooms: [] } }));
  await page.routeWebSocket("**/ws", socket => {
    const send = (message: object) => socket.send(JSON.stringify(message));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw)) as ClientMessage;
      if (message.type !== "sync") return;
      send({ v: 1, type: "ack", requestId: message.requestId, status: "ok", error: null,
        roomId: state.roomId, roomRevision: state.roomRevision, gameRevision: state.gameRevision });
      send(state);
    });
    send({ v: 1, type: "lease", lease: "fullscreen-test", serverTimeUtc: now.toISOString(),
      expiresAtUtc: new Date(now.getTime() + 120000).toISOString() });
  });
  await page.goto(origin);
  await expect(page.getByRole("region", { name: "Mahjong table" })).toBeVisible();
}

function layout(page: Page) {
  return page.evaluate(() => ({
    root: [document.documentElement.scrollWidth, document.documentElement.scrollHeight, scrollX, scrollY],
    boxes: [".site-header", ".board-plane", ".hand-tile", ".table-actions"].map(selector =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON()),
  }));
}

for (const [width, height] of [[1440, 900], [740, 320]] as const) {
  test(`Settings fullscreen keeps a single trusted request and preserves the ${width}×${height} table`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    await page.setViewportSize({ width, height });
    await openTable(page);
    await fullscreenFixture(page, true);
    if (width === 740) await page.evaluate(() => {
      for (const [key, side] of [["t", 10], ["r", 22], ["b", 13], ["l", 25]]) {
        document.documentElement.style.setProperty(`--safe-${key}`, `${side}px`);
      }
    });
    expect(requests).not.toContain("/src/fullscreen.ts");
    const before = await layout(page);
    expect(before.root).toEqual([width, height, 0, 0]);

    const settings = page.getByRole("button", { name: "Settings" });
    await settings.press("Enter");
    const modal = page.getByRole("dialog", { name: "Settings" });
    const enter = modal.getByRole("button", { name: "Enter full screen" });
    const exit = modal.getByRole("button", { name: "Exit full screen" });
    await expect(modal.getByRole("heading")).toBeFocused();
    await expect(enter).toBeEnabled();
    expect(requests).toContain("/src/fullscreen.ts");
    await enter.press("Enter");
    await expect(enter).toBeDisabled();
    await enter.dispatchEvent("click");
    const calls = () => page.evaluate(() => (window as ScreenFixture).screenMode.calls);
    expect(await calls()).toEqual([{ mode: "enter", trusted: true, receiver: true }]);

    await page.evaluate(() => (window as ScreenFixture).screenMode.change(true));
    await expect(exit).toBeDisabled();
    await page.evaluate(() => (window as ScreenFixture).screenMode.finish(true));
    await expect(exit).toBeFocused();
    await expect(exit).toBeEnabled();
    await exit.press("Space");
    await page.evaluate(() => (window as ScreenFixture).screenMode.finish(false));
    await expect(modal.getByRole("status").filter({ hasText: "Couldn’t change full screen" })).toBeVisible();
    await expect(exit).toBeEnabled();
    expect(await calls()).toEqual([
      { mode: "enter", trusted: true, receiver: true }, { mode: "exit", trusted: true, receiver: true },
    ]);

    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await page.evaluate(() => (window as ScreenFixture).screenMode.change(false, false));
    await settings.press("Enter");
    await expect(enter).toBeEnabled();
    await expect(modal.getByText("Couldn’t change full screen", { exact: false })).toBeHidden();
    await modal.getByRole("button", { name: "Close dialog" }).press("Enter");
    await expect(settings).toBeFocused();
    expect(requests).not.toContain("/api/profile");
    expect(await layout(page)).toEqual(before);
  });
}

test("unsupported fullscreen explains the browser fallback without disabling Settings", async ({ page }) => {
  await openTable(page);
  await fullscreenFixture(page, false);
  await page.getByRole("button", { name: "Settings" }).tap();
  const modal = page.getByRole("dialog", { name: "Settings" });
  await expect(modal.getByRole("button", { name: "Enter full screen" })).toBeDisabled();
  await expect(modal.getByText("Full screen is unavailable here.", { exact: false })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Save settings" })).toBeEnabled();
});

test.describe("native fullscreen", () => {
  test.use({ isMobile: false, viewport: { width: 740, height: 320 } });

  test("Settings stays tappable above the enlarged document", async ({ page }) => {
    await openTable(page);
    const settings = page.getByRole("button", { name: "Settings" });
    await settings.tap();
    const modal = page.getByRole("dialog", { name: "Settings" });
    const enter = modal.getByRole("button", { name: "Enter full screen" });
    const exit = modal.getByRole("button", { name: "Exit full screen" });
    await expect(enter).toBeVisible();
    if (await enter.isDisabled()) {
      await expect(modal.getByText("Full screen is unavailable here.", { exact: false })).toBeVisible();
      return;
    }
    await enter.tap();
    const denied = modal.getByText("Couldn’t change full screen", { exact: false });
    await expect(exit.or(denied)).toBeVisible();
    if (await denied.isVisible()) return;
    expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await exit.tap();
    await expect(enter).toBeEnabled();
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await modal.getByRole("button", { name: "Close dialog" }).tap();
    await expect(settings).toBeFocused();
  });
});

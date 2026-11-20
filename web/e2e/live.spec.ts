import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Ack, ClientMessage, Command, Option, Snapshot } from "../src/protocol";

class Player {
  state: Snapshot | null = null;
  sockets = 0;
  readonly errors: string[] = [];
  readonly choices: Command[] = [];
  readonly acks = new Map<string, Ack>();
  readonly kinds = new Set<string>();
  readonly publicMelds = new Set<string>();
  readonly settlements = new Set<string>();

  constructor(readonly page: Page) {
    page.on("pageerror", error => this.errors.push(error.message));
    page.on("websocket", socket => {
      if (new URL(socket.url()).pathname !== "/ws") return;
      this.sockets++;
      socket.on("framereceived", ({ payload }) => {
        const message = parse(payload);
        if (message?.type === "snapshot") {
          this.state = message;
          message.game?.seats.forEach(seat => seat.melds.forEach(meld => this.publicMelds.add(
            meld.method ? `${meld.kind}:${meld.method}` : meld.kind,
          )));
          if (message.game?.settlement) this.settlements.add(message.game.settlement.reason);
        }
        if (message?.type === "ack") this.acks.set(message.requestId, message);
      });
      socket.on("framesent", ({ payload }) => {
        const message = parse(payload);
        if (message?.type === "command" && message.op === "choose") this.choices.push(message);
      });
    });
  }

  async open(url?: string): Promise<void> {
    await this.page.goto(url ?? "/");
    await expect(this.page.locator('.connection[data-status="online"]')).toBeVisible();
  }

  async waitFor(condition: (state: Snapshot) => boolean, timeout = 10000): Promise<Snapshot> {
    await expect.poll(() => !!this.state && condition(this.state), { timeout }).toBe(true);
    return this.state!;
  }

  async click(name: string | RegExp): Promise<void> {
    await this.page.getByRole("button", { name, exact: typeof name === "string" }).tap();
  }
}

function parse(payload: string | Buffer): (Ack | Snapshot | ClientMessage) | null {
  try { return JSON.parse(payload.toString()); } catch { return null; }
}

async function other(browser: Browser, baseURL: string, width = 393): Promise<{ player: Player; context: BrowserContext }> {
  const context = await browser.newContext({
    baseURL, viewport: { width, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1,
  });
  return { player: new Player(await context.newPage()), context };
}

type CloseLog = Window & { lanternCloseCodes?: number[] };

async function trackSocketCloses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const closes: number[] = [];
    (window as CloseLog).lanternCloseCodes = closes;
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("close", event => { closes.push(event.code); });
      }
    };
  });
}

async function trackFirstTouchAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let resumes = 0;
    const Safari = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audio = (window.AudioContext ?? Safari).prototype;
    const resume = audio.resume;
    audio.resume = function () {
      resumes++;
      return resume.call(this).then(() => { document.documentElement.dataset.audioState = this.state; });
    };
    window.addEventListener("pointerdown", () => {
      document.documentElement.dataset.audioResumesBeforeTouch = String(resumes);
    }, { capture: true, once: true });
  });
}

async function observeRecovery(page: Page): Promise<{
  attempts: Command[]; order: string[]; holdNextBot: () => Promise<() => void>;
}> {
  let first = true;
  let botWaiting: ((release: () => void) => void) | null = null;
  const attempts: Command[] = [];
  const order: string[] = [];
  await page.routeWebSocket("**/ws", route => {
    const socket = route.connectToServer();
    route.onMessage(payload => {
      const message = parse(payload);
      if (message?.type === "command" && message.op === "setBot" && botWaiting) {
        const deferred = botWaiting;
        botWaiting = null;
        deferred(() => socket.send(payload));
        return;
      }
      if (message?.type === "command" && message.op === "setReady") {
        attempts.push(message);
        order.push("ready");
      }
      if (message?.type === "sync") order.push("sync");
      socket.send(payload);
    });
    socket.onMessage(payload => {
      const message = parse(payload);
      if (first && message?.type === "ack" && message.status === "ok" && message.requestId === attempts[0]?.requestId) {
        first = false;
        route.close({ code: 1012, reason: "test transport restart" });
      } else {
        if (!first && message?.type === "snapshot") order.push("snapshot");
        route.send(payload);
      }
    });
  });
  return { attempts, order, holdNextBot: () => new Promise(resolve => { botWaiting = resolve; }) };
}

async function createTable(player: Player, visibility: "invite" | "public", match: "One hand" | "Four hands", bots: boolean): Promise<Snapshot> {
  await player.click("Create table");
  const dialog = player.page.getByRole("dialog", { name: "Create a table" });
  await dialog.getByLabel("Who can join?").selectOption(visibility);
  await dialog.getByLabel("Match length").selectOption({ label: match });
  if (bots) await dialog.getByLabel("Fill the other three seats with bots").check();
  await dialog.getByRole("button", { name: "Create table" }).tap();
  await expect(player.page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
  return player.waitFor(state => state.room.status === "waiting" && state.room.visibility === visibility);
}

function pick(player: Player): Option | undefined {
  const options = player.state?.self.legalOptions ?? [];
  const first = (kind: Option["kind"]) => options.find(option => option.kind === kind);
  const optionalPass = !player.kinds.has("pass") && player.state?.game?.window?.reason !== "opening" ? first("pass") : undefined;
  return first("hu") ?? first("reveal") ?? optionalPass ?? first("gang") ?? first("bu") ??
    first("peng") ?? first("chi") ?? first("draw") ?? options.find(option => option.kind === "discard" &&
      option.tileIds[0] === player.state?.self.drawnTileId) ?? first("discard") ?? first("pass");
}

async function step(player: Player, handled: Set<string>): Promise<boolean> {
  const state = player.state;
  const window = state?.game?.window;
  if (!state || !window?.deadlineUtc || state.room.paused || handled.has(window.windowId)) return false;
  const option = pick(player);
  if (!option) return false;
  const count = player.choices.length;
  try {
    if (option.kind === "discard") {
      const tile = player.page.locator(`[data-tile-id="${option.tileIds[0]}"]`);
      if (await tile.getAttribute("aria-pressed", { timeout: 500 }) !== "true") await tile.tap({ timeout: 700 });
      expect(player.choices.length, "tile tap must not send a command").toBe(count);
      await player.page.getByRole("button", { name: /^Discard [1-9] / }).tap({ timeout: 1000 });
    } else {
      await player.page.locator(`[data-option="${option.kind}"]`).first().tap({ timeout: 700 });
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    return false;
  }
  await expect.poll(() => player.choices.length, { timeout: 3000 }).toBeGreaterThan(count);
  const choice = player.choices.at(-1)!;
  expect(choice.op).toBe("choose");
  if (choice.op !== "choose") return false;
  expect(choice.payload.windowId).toBe(window.windowId);
  expect(choice.payload.anchorGameRevision).toBe(window.anchorGameRevision);
  expect(Object.keys(choice.payload).sort()).toEqual(["anchorGameRevision", "optionId", "roomId", "windowId"]);
  const actual = state.self.legalOptions.find(legal => legal.optionId === choice.payload.optionId);
  expect(actual?.kind).toBe(option.kind);
  player.kinds.add(option.kind);
  handled.add(window.windowId);
  return true;
}

async function play(players: Player[], settled: () => boolean, maxMs = 125000): Promise<void> {
  const deadline = Date.now() + maxMs;
  const handled = players.map(() => new Set<string>());
  while (Date.now() < deadline && !settled()) {
    const moved = await Promise.all(players.map((player, i) => step(player, handled[i])));
    if (!moved.some(Boolean)) await new Promise(resolve => setTimeout(resolve, 55));
  }
  expect(settled(), "the real room should reach the requested committed status").toBe(true);
}

test("invite table with two cookie sessions: settings, chat, retry, legal match and rematch", async ({ page, context, browser, baseURL }, testInfo) => {
  test.setTimeout(155000);
  const host = new Player(page);
  const recovery = await observeRecovery(page);
  const { player: visitor, context: visitorContext } = await other(browser, baseURL!);
  try {
    await host.open();
    await page.getByLabel("Display name").fill("River Host");
    const waiting = await createTable(host, "invite", "One hand", false);
    expect(waiting.room.rulesVersion).toBe("changsha-v1");
    await host.click("Invite friends");
    const invitation = await page.getByRole("textbox", { name: "Invite link", exact: true }).inputValue();
    const link = new URL(invitation);
    expect(link.search).toBe("");
    expect(link.pathname).toBe("/");
    expect(Array.from(new URLSearchParams(link.hash.slice(1)).keys())).toEqual(["invite"]);
    await host.click("Close dialog");

    await visitor.open(invitation);
    await expect(visitor.page.getByText("Invitation detected.", { exact: false })).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: "Join", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(visitor.page.locator(`.room-row[data-key="${waiting.roomId}"]`)).toHaveCount(0);
    await visitor.page.getByLabel("Display name").fill("Jade Visitor");
    await visitor.click("Join");
    const joined = await visitor.waitFor(state => state.roomId === waiting.roomId && state.self.seat !== waiting.self.seat);
    expect(joined.self.inviteCode).toBeNull();
    await expect.poll(() => new URL(visitor.page.url()).hash).toBe("");
    const guestValue = async (browserContext: BrowserContext) => (await browserContext.cookies()).find(cookie => cookie.name === "mahjong_guest");
    const primaryCookie = await guestValue(context);
    const visitorCookie = await guestValue(visitorContext);
    expect(Boolean(primaryCookie?.httpOnly && visitorCookie?.httpOnly && primaryCookie.value !== visitorCookie.value)).toBe(true);

    await host.click("Settings");
    const prefs = page.getByRole("dialog", { name: "Settings" });
    await prefs.getByLabel("Tile and turn sounds").uncheck();
    await prefs.getByLabel("Quiet table music").check();
    await prefs.getByLabel("Reduce visual motion").check();
    const volume = prefs.getByRole("slider");
    await volume.focus();
    const newVolume = String(Number(await volume.inputValue()) + 1);
    await volume.press("ArrowRight");
    await host.click("Save settings");
    await expect(prefs.getByText("Settings saved.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await host.click("Close dialog");
    await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
    await host.open();
    await host.waitFor(state => state.roomId === waiting.roomId);
    await host.click("Settings");
    await expect(prefs.getByLabel("Tile and turn sounds")).not.toBeChecked();
    await expect(prefs.getByLabel("Quiet table music")).toBeChecked();
    await expect(prefs.getByLabel("Reduce visual motion")).toBeChecked();
    await expect(volume).toHaveValue(newVolume);
    await host.click("Close dialog");

    await host.click("Table chat");
    await page.getByRole("textbox", { name: "Message" }).fill("<b>plain text</b>");
    await host.click("Send");
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
    await visitor.click("Table chat");
    const visitorLog = visitor.page.getByRole("log");
    await expect(visitorLog.getByText("<b>plain text</b>", { exact: true })).toBeVisible();
    await expect(visitorLog.locator("b")).toHaveCount(0);
    await host.click("Close dialog");
    await visitor.click("Close dialog");

    const delayed = recovery.holdNextBot();
    await host.click("Add bot to West seat");
    const release = await delayed;
    await visitor.click("Table chat");
    await visitor.page.getByRole("textbox", { name: "Message" }).fill("Ready to play.");
    await visitor.click("Send");
    await host.waitFor(state => state.room.chat.length === 2);
    await visitor.click("Close dialog");
    release();
    await expect(page.getByText("The room changed while you were acting.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add bot to West seat" })).toBeEnabled();
    await host.click("Add bot to West seat");
    await host.click("Add bot to North seat");
    const beforeReady = await host.waitFor(state => state.room.seats.filter(seat => seat.kind === "bot").length === 2);
    await host.click("Mark ready");
    await expect.poll(() => recovery.attempts.length).toBe(2);
    expect(JSON.stringify(recovery.attempts[0]) === JSON.stringify(recovery.attempts[1]), "retry uses original ID, lease and payload").toBe(true);
    const beforeRetry = recovery.order.slice(0, recovery.order.lastIndexOf("ready"));
    expect(beforeRetry.lastIndexOf("sync")).toBeGreaterThan(beforeRetry.indexOf("ready"));
    expect(beforeRetry.lastIndexOf("snapshot")).toBeGreaterThan(beforeRetry.lastIndexOf("sync"));
    const ready = await host.waitFor(state => state.room.seats.find(seat => seat.seat === state.self.seat)?.ready === true);
    expect(ready.roomRevision).toBe(beforeReady.roomRevision + 1);
    await visitor.click("Mark ready");
    await host.click("Start match");
    const started = await host.waitFor(state => state.room.status === "playing" && state.game?.handNumber === 1);
    await visitor.waitFor(state => state.room.status === "playing");
    await expect(page.locator(".hand-tile")).toHaveCount(started.self.hand.length);
    await expect(visitor.page.locator(".hand-tile")).toHaveCount(visitor.state!.self.hand.length);
    expect(started.self.hand.some(tile => visitor.state!.self.hand.some(otherTile => otherTile.tileId === tile.tileId))).toBe(false);
    expect(started.game!.seats.every(seat => !("hand" in seat))).toBe(true);
    await host.click("Pause");
    const paused = await host.waitFor(state => state.room.paused);
    expect(paused.self.legalOptions).toHaveLength(0);
    if (paused.game?.window) expect(paused.game.window.deadlineUtc).toBeNull();
    await expect(page.getByText("Table paused", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("live-two-human-table.png"), fullPage: true });
    await host.click("Resume");
    await host.waitFor(state => !state.room.paused);

    await play([host, visitor], () => host.state?.room.status === "complete");
    const finished = await visitor.waitFor(state => state.room.status === "complete");
    expect(host.kinds.has("discard")).toBe(true);
    const result = page.getByRole("dialog", { name: "Match results" });
    await expect(result.getByRole("row")).toHaveCount(5);
    expect(finished.game!.settlement!.seatResults.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
    expect(await result.getByRole("row").nth(1).getByRole("cell").nth(1).textContent()).toBe(
      finished.game!.settlement!.seatResults[0].total > 0 ? `+${finished.game!.settlement!.seatResults[0].total}` :
        String(finished.game!.settlement!.seatResults[0].total));
    await expect(visitor.page.getByRole("button", { name: "Rematch" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("live-match-results.png"), fullPage: true });
    const beforeRematch = host.state!;
    await host.click("Rematch");
    const rematch = await host.waitFor(state => state.room.status === "waiting" && state.game === null);
    await expect(page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start match" })).toBeDisabled();
    expect(rematch.roomId).toBe(beforeRematch.roomId);
    expect(rematch.gameRevision).toBeGreaterThan(beforeRematch.gameRevision);
    expect(rematch.room.seats.map(seat => seat.kind)).toEqual(["human", "human", "bot", "bot"]);
    expect(rematch.room.seats.filter(seat => seat.kind === "human").every(seat => !seat.ready)).toBe(true);
    expect(rematch.room.chat).toHaveLength(2);
    await writeFile(testInfo.outputPath("actions.json"), JSON.stringify({
      host: [...host.kinds], visitor: [...visitor.kinds], publicMelds: [...host.publicMelds], settlements: [...host.settlements],
    }));
    expect(host.errors).toEqual([]);
    expect(visitor.errors).toEqual([]);
  } finally { await visitorContext.close(); }
});

test("normal pacing: public discovery, atomic bot table, takeover and a real discard", async ({ page, context, browser, baseURL }, testInfo) => {
  const host = new Player(page);
  await trackSocketCloses(page);
  await trackFirstTouchAudio(page);
  const { player: visitor, context: visitorContext } = await other(browser, baseURL!, 430);
  try {
    await page.goto("/");
    // A raw touch avoids locator evaluations granting activation before the first gesture.
    await page.touchscreen.tap(26, 28);
    await expect(page.locator("html")).toHaveAttribute("data-audio-resumes-before-touch", "0");
    await expect(page.locator("html")).toHaveAttribute("data-audio-state", "running");
    await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("lantern-home-390.png"), fullPage: true });
    await page.route("**/api/rooms", route => route.abort("connectionfailed"));
    await host.click("Refresh public tables");
    await expect(page.getByText("Couldn’t load the list.", { exact: false })).toBeVisible();
    await page.unroute("**/api/rooms");
    const publicTable = await createTable(host, "public", "Four hands", false);
    await visitor.open();
    const listed = visitor.page.locator(`.room-row[data-key="${publicTable.roomId}"]`);
    await expect(listed).toContainText("1 / 4 seats · Four hands");
    await listed.getByRole("button").tap();
    await visitor.waitFor(state => state.roomId === publicTable.roomId);
    await visitor.click("Leave table");
    await expect(visitor.page.getByRole("heading", { name: "Find your fourth." })).toBeVisible();
    await host.click("Leave table");
    await expect(page.getByRole("heading", { name: "Find your fourth." })).toBeVisible();

    await host.click("Play with bots");
    const botTable = await host.waitFor(state => state.roomId !== publicTable.roomId && state.room.seats.filter(seat => seat.kind === "bot").length === 3);
    expect(botTable.roomRevision).toBe(1);
    const second = new Player(await context.newPage());
    await trackSocketCloses(second.page);
    await second.open();
    await second.waitFor(state => state.roomId === botTable.roomId);
    await expect(page.locator('.connection[data-status="taken-over"]')).toBeVisible();
    expect(await page.evaluate(() => (window as CloseLog).lanternCloseCodes)).toContain(4001);
    const sockets = host.sockets;
    await expect(page.getByText("This tab will not reconnect on its own.", { exact: false })).toBeVisible();
    await new Promise(resolve => setTimeout(resolve, 1400));
    expect(host.sockets).toBe(sockets);
    await host.click("Use this tab");
    await expect(page.locator('.connection[data-status="online"]')).toBeVisible();
    await expect.poll(() => second.page.evaluate(() => (window as CloseLog).lanternCloseCodes)).toContain(4001);
    await expect(second.page.locator('.connection[data-status="taken-over"]')).toBeVisible();
    await second.page.close();

    await page.setViewportSize({ width: 800, height: 360 });
    await host.click("Mark ready");
    await host.click("Start match");
    const table = page.getByRole("region", { name: "Mahjong table" });
    await expect(table).toBeVisible();
    await play([host], () => host.state?.self.legalOptions.some(option => option.kind === "discard") === true, 25000);
    const decision = host.state!;
    const decisionWindow = decision.game!.window!;
    const discards = decision.self.legalOptions.filter(option => option.kind === "discard");
    const option = discards.find(item => item.tileIds[0] === decision.self.drawnTileId) ?? discards[0];
    const tileId = option.tileIds[0];
    const tile = table.locator(`[data-tile-id="${tileId}"]`);
    const confirm = table.getByRole("button", { name: /^Discard / });
    const sent = host.choices.length;
    const layouts = [
      { width: 800, height: 360, insets: [10, 22, 13, 25], minBoardWidth: 460 },
      { width: 800, height: 360, insets: [0, 0, 0, 0], minBoardWidth: 460 },
      { width: 740, height: 320, insets: [10, 22, 13, 25], minBoardWidth: 430 },
      { width: 667, height: 320, insets: [0, 0, 0, 0], minBoardWidth: 370 },
    ];
    const composition = [];
    for (const { width, height, insets, minBoardWidth } of layouts) {
      await page.setViewportSize({ width, height });
      await page.evaluate(margins => {
        ["t", "r", "b", "l"].forEach((edge, i) => document.documentElement.style.setProperty(`--safe-${edge}`, `${margins[i]}px`));
        window.scrollTo(0, 0);
      }, insets);
      await expect(tile).toHaveAttribute("aria-disabled", "false");
      const before = (await tile.boundingBox())!;
      const noInsetLandscape = width === 800 && insets.every(value => !value);
      if (noInsetLandscape) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 1);
      await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2);
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await expect(confirm).toBeEnabled();
      expect(host.choices, "Only the explicit confirmation may send a choice.").toHaveLength(sent);
      const after = await table.evaluate((node, id) => {
        const bounds = (selector: string) => {
          const element = node.querySelector(selector)!;
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom, transform: getComputedStyle(element).transform };
        };
        return {
          board: bounds(".board-plane"), rack: bounds(".hand-grid"), controls: bounds(".table-actions"),
          tile: bounds(`[data-tile-id="${CSS.escape(id)}"]`),
          confirm: bounds(".discard-confirm"), pause: bounds(".pause-btn"),
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight, scrollY: window.scrollY,
        };
      }, tileId);
      expect(after.documentWidth).toBe(width);
      if (noInsetLandscape) expect(after.documentHeight).toBeLessThanOrEqual(height + 1);
      expect(after.scrollY).toBe(0);
      expect(after.board.width).toBeGreaterThan(minBoardWidth);
      expect(after.board.x).toBeGreaterThanOrEqual(insets[3]);
      expect(after.board.right).toBeLessThan(after.controls.x);
      expect(after.rack.y).toBeGreaterThan(after.board.bottom);
      expect(after.rack.bottom).toBeLessThanOrEqual(height - insets[2]);
      expect(after.tile).toMatchObject(before);
      for (const target of [after.tile, after.confirm, after.pause]) {
        expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44);
        expect(target.transform).toBe("none");
        expect(target.x).toBeGreaterThanOrEqual(insets[3]);
        expect(target.y).toBeGreaterThanOrEqual(insets[0]);
        expect(target.right).toBeLessThanOrEqual(width - insets[1]);
        expect(target.bottom).toBeLessThanOrEqual(height - insets[2]);
      }
      composition.push({ viewport: [width, height], insets, ...after });
      await page.screenshot({ path: testInfo.outputPath(`landscape-live-table-${width}${insets[0] ? "-insets" : ""}.png`) });
      if (width !== layouts.at(-1)!.width) await tile.press("Escape");
    }

    const commit = composition.at(-1)!.confirm;
    await page.touchscreen.tap(commit.x + commit.width / 2, commit.y + commit.height / 2);
    await expect.poll(() => host.choices.length).toBe(sent + 1);
    const discard = host.choices.at(-1)!;
    if (discard.op !== "choose") throw new Error("Expected an authoritative discard choice.");
    expect(discard.payload).toEqual({ roomId: decision.roomId, windowId: decisionWindow.windowId,
      anchorGameRevision: decisionWindow.anchorGameRevision, optionId: option.optionId });
    await expect.poll(() => host.acks.get(discard.requestId)?.status).toBe("ok");
    const committed = await host.waitFor(state => state.gameRevision > decision.gameRevision &&
      state.game?.window?.windowId !== decisionWindow.windowId);
    await expect(tile).toHaveCount(0);
    expect(host.state?.game?.handNumber).toBe(1);
    const projectedTurnSeconds = Math.ceil((Date.parse(decisionWindow.deadlineUtc!) - Date.parse(decision.serverTimeUtc)) / 1000);
    expect(projectedTurnSeconds).toBeGreaterThanOrEqual(24);
    expect(projectedTurnSeconds).toBeLessThanOrEqual(30);
    await expect(page.locator(".wall-count")).not.toHaveText("");
    await writeFile(testInfo.outputPath("live-decision.json"), JSON.stringify({
      browser: browser.version(), projectedTurnSeconds, revision: committed.gameRevision, composition,
    }));
    await host.click("Settings");
    await host.click("Back to lobby");
    await expect(page.getByRole("button", { name: "Resume your table" })).toBeEnabled();
    await host.click("Resume your table");
    await expect(page.getByRole("region", { name: "Mahjong table" })).toBeVisible();
    expect(host.state?.roomId).toBe(botTable.roomId);
    expect(host.errors).toEqual([]);
  } finally { await visitorContext.close(); }
});

test("four-hand match preserves scores and next dealer through final settlement", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const host = new Player(page);
  await host.open();
  await createTable(host, "invite", "Four hands", true);
  await host.click("Mark ready");
  await host.click("Start match");
  for (const hand of [1, 2, 3, 4]) {
    const final = hand === 4;
    await play([host], () => host.state?.room.status === (final ? "complete" : "betweenHands") && host.state.game?.handNumber === hand, 55000);
    const settled = host.state!.game!.settlement!;
    const result = page.getByRole("dialog", { name: final ? "Match results" : "Hand results" });
    await expect(result.getByText(`Hand ${hand} of 4`)).toBeVisible();
    expect(settled.seatResults.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
    if (final) break;
    await host.click("Next hand");
    const next = await host.waitFor(state => state.room.status === "playing" && state.game?.handNumber === hand + 1);
    expect(next.game!.dealerSeat).toBe(settled.nextDealerSeat);
    expect(next.game!.seats.map(seat => seat.total)).toEqual(settled.seatResults.map(seat => seat.total));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(`Hand ${hand + 1} / 4`)).toBeVisible();
  }
  await writeFile(testInfo.outputPath("actions.json"), JSON.stringify({
    host: [...host.kinds], publicMelds: [...host.publicMelds], settlements: [...host.settlements],
  }));
  expect(host.errors).toEqual([]);
});

import { expect, test } from "@playwright/test";
import type { Guest, Snapshot } from "../src/protocol";

test("a mounted guest can share an invite, start a live hand, and reload into the same seat", async ({
  page, context, browser, baseURL, request,
}) => {
  const home = new URL(baseURL!);
  test.skip(home.pathname === "/", "Run against the published app with SMOKE_PATH_BASE=/mahjong.");
  const mount = home.pathname.slice(0, -1);
  const online = '.connection[data-status="online"]';
  const responses = new Map<string, { status: number; mime: string }>();
  const sockets = new Set<string>();
  const errors: string[] = [];
  let snapshot: Snapshot | undefined;
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === home.origin) {
      responses.set(url.pathname, { status: response.status(), mime: response.headers()["content-type"] ?? "" });
    }
  });
  page.on("websocket", socket => {
    sockets.add(socket.url());
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(payload.toString());
      if (message.type === "snapshot") snapshot = message;
    });
  });
  const tap = (name: string) => page.getByRole("button", { name, exact: true }).tap();

  // A nested browser URL must still resolve the built entry assets, APIs and socket from the mount.
  const nested = new URL("play/reconnect?from=browser", home);
  await page.goto(nested.href);
  await expect(page.locator(online)).toBeVisible();
  await page.getByLabel("Display name").fill("Mounted Host");
  await tap("Create table");
  await page.getByRole("dialog", { name: "Create a table" }).getByRole("button", { name: "Create table" }).tap();
  await expect(page.getByRole("heading", { name: "Take a seat." })).toBeVisible();
  await tap("Invite friends");
  const invite = new URL(await page.getByRole("textbox", { name: "Invite link" }).inputValue());
  expect(invite.origin + invite.pathname + invite.search).toBe(home.href);
  expect(invite.username + invite.password).toBe("");
  expect([...new URLSearchParams(invite.hash.slice(1))]).toEqual([["invite", expect.stringMatching(/^[\w-]{16}$/)]]);
  await tap("Close dialog");

  const visitorContext = await browser.newContext({ hasTouch: true });
  try {
    const visitor = await visitorContext.newPage();
    const bare = new URL(invite);
    bare.pathname = mount;
    bare.search = "?from=invite%2Fbrowser";
    const redirect = await request.get(bare.href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    expect(redirect.headers().location).toBe(home.pathname + bare.search);
    invite.search = bare.search;
    await visitor.goto(bare.href);
    await expect(visitor).toHaveURL(invite.href);
    await expect(visitor.getByText("Invitation detected.", { exact: false })).toBeVisible();
    await expect(visitor.locator(online)).toBeVisible();
    await visitor.getByRole("button", { name: "Join", exact: true }).tap();
    await expect(visitor.getByRole("heading", { name: "Take a seat." })).toBeVisible();
    invite.hash = "";
    await expect(visitor).toHaveURL(invite.href);
    await visitor.reload();
    await expect(visitor).toHaveURL(invite.href);
    await expect(visitor.getByRole("heading", { name: "Take a seat." })).toBeVisible();

    await tap("Add bot to West seat");
    await tap("Add bot to North seat");
    await tap("Mark ready");
    // The visitor must act on the room revision that includes the host's ready command.
    const hostSeat = visitor.getByRole("article").filter({ has: visitor.getByRole("heading", { name: "Mounted Host", exact: true }) });
    await expect(hostSeat.getByText(/ · Ready$/)).toBeVisible();
    await visitor.getByRole("button", { name: "Mark ready", exact: true }).tap();
    await expect(visitor.getByRole("button", { name: "Not ready", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start match", exact: true })).toBeEnabled();
    await tap("Start match");
    await expect.poll(() => snapshot?.room.status).toBe("playing");
    expect(snapshot?.game?.handNumber).toBe(1);
    const tile = page.locator(".hand-tile .tile-face use").first();
    await expect(tile).toHaveAttribute("href", /#lt-[bcd][1-9]$/);
    const sheet = new URL((await tile.getAttribute("href"))!);
    expect(sheet.origin).toBe(home.origin);
    expect(sheet.pathname).toMatch(/\/assets\/tile-suits-[\w-]+\.svg$/);
    await expect.poll(() => responses.get(sheet.pathname)).toEqual({ status: 200, mime: "image/svg+xml" });

    await tap("Settings");
    await expect.poll(() => [...responses].some(([path, asset]) =>
      /\/assets\/fullscreen-[\w-]+\.js$/.test(path) && asset.status === 200)).toBe(true);
    await tap("Close dialog");
    for (const [name, ext] of [["index", "js"], ["index", "css"], ["actors", "js"], ["actors", "css"]]) {
      expect([...responses].some(([path, asset]) =>
        new RegExp(`/assets/${name}-[\\w-]+\\.${ext}$`).test(path) && asset.status === 200), `${name}.${ext} response`).toBe(true);
    }

    const cookie = (await context.cookies(home.href)).find(item => item.name === "mahjong_guest");
    expect(cookie).toMatchObject({ path: mount, httpOnly: true, sameSite: "Lax", secure: home.protocol === "https:" });
    expect((await context.cookies(`${home.origin}${mount}-other/`)).some(item => item.name === "mahjong_guest")).toBe(false);
    const roomId = snapshot!.roomId;
    const seat = snapshot!.self.seat;
    const resume = page.waitForResponse(response => response.url() === new URL("api/guest", home).href
      && response.request().method() === "POST");
    snapshot = undefined;
    await page.reload();
    await expect(page).toHaveURL(nested.href);
    const guest: Guest = await (await resume).json();
    expect(guest).toMatchObject({ displayName: "Mounted Host", resumeRoomId: roomId });
    await expect.poll(() => ({ roomId: snapshot?.roomId, seat: snapshot?.self.seat })).toEqual({ roomId, seat });
    await expect(page.locator(".hand-tile").first()).toBeVisible();
    await expect(page.locator(online)).toBeVisible();
    for (const route of ["api/guest", "api/profile", "api/rooms"]) {
      expect(responses.get(home.pathname + route)?.status, route).toBe(200);
    }
    expect([...responses.keys()].filter(path => !path.startsWith(home.pathname))).toEqual([]);
    const socket = new URL("ws", home);
    socket.protocol = home.protocol === "https:" ? "wss:" : "ws:";
    expect([...sockets]).toEqual([socket.href]);
    expect(errors).toEqual([]);
  } finally {
    await visitorContext.close();
  }
});

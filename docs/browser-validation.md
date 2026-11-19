# Browser validation

## Reproduce

Build the client with `npm --prefix web ci` and `npm --prefix web run build`, then serve `web/dist` at the origin root with the real [Mahjong server](architecture.md#local-handoff-and-validation). Install the locked Playwright browsers (`npm --prefix web exec -- playwright install chromium webkit`; provide their OS libraries as needed). For the full suite, use an isolated `Testing` server with `Mahjong__Testing__BotDelayMilliseconds=85` and `Mahjong__Testing__TickMilliseconds=25`:

```sh
BASE_URL=http://127.0.0.1:8080 npm --prefix web run test:e2e
```

`npm --prefix web run test:geometry` runs just the renderer checks without a Mahjong server. Playwright starts an isolated Vite fixture server on port `4179`; set `MAHJONG_GEOMETRY_PORT` if that port is in use. The fixture has no WebSocket or Room API. The live specs use real TCP/HTTP/WebSocket connections, independent guest cookie contexts, and a real SQLite-backed game; the transport test delays one actual stale command and drops one already-committed acknowledgement. It injects no game snapshots or choices.

## Touch and geometry

Development validation ran on Ubuntu 26.04.1 LTS with Playwright 1.65.1: **Chromium 159.0.8154.6** and **WebKit 27.2**. Both used mobile viewport and touch emulation with device scale factor 1. These are desktop browser engines, not physical iOS/iPadOS Safari or Android Chrome. Actual notches, scrolling browser chrome, soft keyboards, audio playback on mobile hardware and screen-reader output still need device checks.

- At **390×780, 393×780 and 430×780 CSS pixels**, tap the four corners (2 px inside) and center of all 13 pre-draw tiles, 14 post-draw tiles, and 18 physical four-kong fixture tiles. A draw retains existing DOM nodes. Every tap is checked against a new native touch event, its target, and the absence of a discard. The `Discard` button is the only commit. Browser touch-target adjustment may select an adjacent tile in the tiny gap between targets; it never discards.
- At **360×800 → 800×360**, check the four projected corners and tap four projected lane markers. A second **800×360** case repeats the taps on every physical four-kong tile, including the raised added tile and four concealed faces. Insets of top/right/bottom/left **10/22/13/25 px** are simulated, not measured hardware insets.
- In the 390 px four-kong fixture the meld targets span `x=17–373`, the concealed tiles end by `y=640`, and the discard confirmation is fully visible. At 800×360 the meld targets span `x=413.63–769.63`, and the concealed tiles finish at `y=336.78`, inside the simulated bottom-safe bound of `347`. Both engines measured the projected near/far width ratio at about **1.105** in the inset portrait and **1.061** in the inset landscape. No horizontal overflow was observed in the checked layouts.
- Targets are at least **44×44 CSS px** in both orientations. Added kongs occupy distinct, vertically stacked hit targets, not overlapping touch regions. The only projected surface is the board; local controls and hit targets are untransformed DOM. A CSS mutation disabling native tile pointer events failed the 390 px check at the first touched corner.

## Live coverage and pacing

On 2026-11-19 the full suite passed **14/14** after the server’s graceful takeover-close fix. It exercises public discovery and its error/retry path, private invite fragment admission without seat credentials, two real guest contexts plus two bots, an atomic three-bot table, ready/start, persisted preferences, literal-text chat, pause/resume, stale room recovery, original-lease command replay, and two native `4001` takeovers without an automatic reconnect. Both the one-hand match/rematch and a full four-hand match are checked in each engine; each intermediate `Next hand` keeps scores and follows the server’s next dealer.

Those runs observed live discards, passes, Chi, Peng, opening reveal and Supplement (`bu`), including committed open four-tile melds; game settlements included wins and a draw. Not every rare legal option occurred in live samples. Deterministic seeds and forced edge cases such as added and concealed kongs belong to [Rules tests](rules.md#reducer-projections-and-verification), not the browser fixture or a live seed route.

The repeatable browser suite uses fresh server seeds and faster bots/ticks but production **30 s turn / 8 s claim windows**. The separate `--grep 'normal pacing'` run against a Production host passed **2/2** with the default **700 ms bot delay / 100 ms server tick**. Both browsers saw a projected 30 s turn, selected a real tile, acknowledged the explicit discard, and received the replacing snapshot. A separate coordinator run also passed on Linux Google Chrome **158.0.8127.36** at **390×780** touch emulation with default pacing; capture: session `files/mahjong-normal-pace-results/live-normal-pacing-public--8f184-takeover-and-a-real-discard/lantern-home-390.png`.

## Asset and feedback budget

The production artifact has exactly four files: HTML, one module, one stylesheet, and the [original favicon](assets.md). Measured payload is **73,081 bytes raw / 24,797 bytes gzipped**; first-load budget is **32 KiB gzipped**, excluding room API/WebSocket data. No runtime fonts or media are fetched. Authoritative state renders immediately; an arrival highlight takes 165 ms, does not move hit targets, respects OS and guest reduced-motion preferences, and is cleared across reconnect. There are no queued deal sequences or WebGL fallbacks.

Successful original screenshots and measured geometry JSON are kept in ignored `web/test-results/qualified/` (`four-kong-fixture-390.png`, `four-kong-fixture-landscape.png`, `rack-geometry.json`, `plane-geometry.json`, `live-two-human-table.png`, and `live-match-results.png`). The separate default-pacing run writes `lantern-home-390.png`, `normal-live-table.png`, and `live-decision.json` under `web/test-results/qualified-default/`. These are local test assets, not published app content.

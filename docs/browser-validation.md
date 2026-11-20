# Browser validation

## Reproduce

Build the client with `npm --prefix web ci` and `npm --prefix web run build`, then [publish the real server](operations.md#verify-a-build) with those assets. Install the locked Playwright browsers (`npm --prefix web exec -- playwright install chromium webkit`; provide their OS libraries as needed). Set `publish`, `version`, and `revision` to the artifact path and embedded identity, then run the same browser and persistence smoke as CI:

```sh
ASPNETCORE_ENVIRONMENT=Testing Mahjong__Testing__BotDelayMilliseconds=100 \
  Mahjong__Testing__TurnSeconds=30 Mahjong__Testing__ClaimSeconds=8 \
  MAHJONG_GEOMETRY_PORT=46144 \
  bash scripts/smoke-published.sh "$publish" "$version" "$revision" --with-browser
```

The smoke starts a loopback host and uses disposable data; its restart test restores an offline archive into a fresh directory. Set `MAHJONG_GEOMETRY_PORT` to a free port (default `4179`) for the separate Vite fixtures. `npm --prefix web run test:geometry` runs just the geometry spec, which has no room API or WebSocket. The live specs use real TCP/HTTP/WebSocket connections, independent guest cookies, and SQLite. The transport test delays one actual stale command and drops one already-committed acknowledgement; it injects no game snapshots or choices.

To play the current checkout locally, use the [pinned .NET SDK](../global.json) and Node.js 26.13.1. From the checkout root:

```sh
npm --prefix web ci && npm --prefix web run build
umask 077
Mahjong__DataDirectory="$PWD/artifacts/prototype/desktop-cartoon-local-data" \
  dotnet run --project src/Mahjong.Server --no-launch-profile -- --urls http://127.0.0.1:8080
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080), create a table and fill the other seats with bots. This is a local launch, not a deployed service.

## Touch and geometry

The browser gate runs Playwright 1.65.1 with **Chromium 159.0.8154.6** and **WebKit 27.2**. The touch cases use mobile viewport and touch emulation at device scale factor 1. Actual notches, mobile Safari and Chrome with browser chrome or soft keyboards, hardware audio, and screen-reader output still need device checks. The coordinates and sizes below are measurements from the earlier landscape run on Ubuntu 26.04.1 LTS, not from the combined publish.

- At **390×780, 393×780 and 430×780 CSS pixels**, tap the four corners (2 px inside) and center of all 13 pre-draw tiles, 14 post-draw tiles, and 18 physical four-kong fixture tiles. A draw retains existing DOM nodes. Every tap is checked against a new native touch event, its target, and the absence of a discard. The `Discard` button is the only commit. Browser touch-target adjustment may select an adjacent tile in the tiny gap between targets; it never discards.
- At **360×800 → 800×360**, check the projected corners and four lane markers with simulated top/right/bottom/left insets of **10/22/13/25 px**. Tap all 18 four-kong tiles at **800×360** and **740×320** with the same insets. At 740×320 the earlier four-kong rack ended at **y=282.78** and confirmation at **y=299**, inside the **y=307** safe bound. A separate dealer fixture checks all 14 tiles and the long `Discard 9 characters` label on the same short viewport; the compact regression checks that wrapping the confirmation does not move the rack.
- The real human/three-bot test uses four layouts on the same committed turn. At inset **800×360** and **740×320**, the projected board is about **520 px** and **451 px** wide, and the selected rack ends at **y=335.69** and **y=296.69**. At **667×320** without insets the rack ends at **y=288.69**. At **800×360** without insets, document height is **360 px**. The test checks safe bounds and untransformed **44×44 CSS px** minimum targets, touches and releases a real legal tile without scrolling or sending a command, then taps the explicit confirmation and verifies the exact command, acknowledgment, and removed tile. Very narrow viewports or longer choice lists can still use normal page scrolling.
- Added kongs have distinct, vertically stacked hit targets, not overlapping touch regions. The board is the only projected surface. A historical CSS mutation disabling native tile pointer events failed the 390 px check; the first landscape candidate failed the live 740×320 gate when its dealer label pushed the rack below the safe bound.

## Desktop and motion coverage

- The desktop fixture checks **1280×720, 1440×900 and 1920×1080** with keyboard input: a projected table at least 80% of viewport width, all four seat labels, a single 14-tile row, and a separate `Discard` control, without page overflow. `End` and `Enter` focus and select a tile without discarding. The art fixture checks that all 27 suited faces paint from one passive, same-origin sheet, with no request for it on the landing screen.
- The motion spec drives controlled snapshots through the client. It samples actual deal, draw and discard travel, checks that taps still select and confirm once, and checks distinct call stamps and two seat-local wins at **740×320** with simulated insets. Other cases check immediate state and feedback with reduced motion, and that pause, hiding, resizing and reconnect clear effects rather than replaying them.
- Separate lane evidence: the desktop lane's Chromium capture from a native publish at **1440×900** shows a roughly **1,352 px** wide projected table with readable rivers and traditional suited faces, a flat 14-tile rack and a separate **44 px** high confirm button. The Effects lane's earlier native-server captures show backed deal packets and a public discard in Chromium and WebKit. Its controlled portrait and compact-landscape captures also show the turquoise draw, a Peng burst, and two separately anchored win stamps with signed scores. These captures are from the individual lanes, not a combined run or a frame-rate measurement.

## Live coverage and pacing

**Recorded combined desktop and motion publish (2026-11-20):** The smoke for `artifacts/prototype/desktop-cartoon-check/publish/` logged **38/38** passing cases, **19 Chromium + 19 WebKit**, covering the fixtures and live browser play. The native smoke then verified health, version, static assets and WebSocket admission, paused after a legal choice, and recovered the original guest, preferences, paused game and committed action from the offline restore without replaying it. See `artifacts/prototype/desktop-cartoon-check/smoke.log`.

**Earlier landscape publish (2026-11-20):** **18/18** cases passed, **9 Chromium + 9 WebKit**, against `artifacts/prototype/landscape-publish/`. This was a dirty-tree build based on `bb14458`; `/api/version` reported `0.1.0`, protocol `1`, and revision `unknown`. After the browsers, the smoke seeded a disposable room, made a real choice, paused, and stopped. The new server process on the offline restore recovered the original cookie identity, preferences, exact room/seat checkpoint, and existing command receipt without applying the choice again.

The live tests cover public discovery and retry, private invite admission, two humans plus two bots, a three-bot table, persisted preferences, literal-text chat, pause/resume, stale-room recovery, original-lease retry, and native `4001` tab takeovers. One-hand rematch and a full four-hand match run in each engine; each `Next hand` keeps the totals and follows the server’s next dealer. The test server uses fresh seeds, a **100 ms** bot delay and **30 s turn / 8 s claim** clocks. Both engines observed a projected **30 s** turn in the earlier landscape run. A raw first touch in the real client checks audio unlock without an explicit Sound test action; a separate earlier Production launch in both engines verified first-keyboard-gesture unlock. The renderer fixture separately checks the discard, last-tile and Kong Cannon river markers, added-kong robbery, call and settlement feedback, reduced motion, and audio cue replacement and mute.

**Historical baseline (2026-11-19):** **14/14** browser cases after the server takeover-close fix; a separate **2/2** on a Production host with the default **700 ms** bot delay and **100 ms** server tick. Those results predate both visual passes. Not every rare action occurs in live samples; deterministic rare cases belong to the [Rules tests](rules.md#reducer-projections-and-verification).

## Asset and feedback budget

The combined build's cold landing shell is **30,634 bytes gzipped**, below the **32 KiB** budget. The table adds one deferred SVG of suited faces; the full static table total is **42,429 bytes gzipped**. See [asset provenance and the budget breakdown](assets.md). These are per-file gzip estimates, not measured HTTP transfers. No runtime fonts or media are fetched.

Committed snapshots place tiles, choices, and scores immediately. On a continuous live start or next hand, four staggered gold-trail packets of tile backs travel from the far wall toward the rack. A turquoise draw flies from a side wall to the isolated local draw slot. An orange discard flies from the local tile's former position (or another player's seat label) to that player's river. Chi, Peng, Kong, Supplement and opening reveals get distinct seat-anchored stamps; wins add a burst at each winning seat, with gains rising and losses dropping. These are decorative overlays, not moving hit targets or a replay of the hidden wall.

The automatic results dialog may wait 540 ms for live score feedback; the scores and `Hand results` or `Match results` button are already available. OS or saved reduced motion skips the flights, bursts and lead-in while leaving the rack, call labels and results usable. Initial sync and reconnect do not replay missed motion. Web Audio synthesizes the cues, waits for a trusted gesture, and suppresses stale effects across reconnect, mute, and backgrounding.

The supplied B1–B4 contact sheets show a shallow angled board, a prominent near rack, edge seats, and compact center/score feedback; the Y1 sheet shows a landscape table inside a portrait video frame. These stills informed composition, not the timings, sound, or rules. The cues are original, and the only rules profile is the source-based [Changsha contract](rules.md).

The combined local native publish and smoke evidence use `artifacts/prototype/desktop-cartoon-check/`; the earlier landscape screenshots, geometry and live-decision JSON, smoke output, and checksums remain at `artifacts/prototype/landscape-evidence/`. These are local validation artifacts, not bundled browser content.

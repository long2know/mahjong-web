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

## Frozen Lantern Hall publish

The local `artifacts/lantern-hall-final/publish/` contains the frozen integrated `web/dist` package. With the pinned .NET runtime installed, launch that artifact from the checkout root without rebuilding:

```sh
dotnet artifacts/lantern-hall-final/publish/Mahjong.Server.dll --urls http://127.0.0.1:8080
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). This is a loopback launch, not a public deployment or physical-device qualification.

The integrated root passed **58 Rules tests** and **8 Server tests**; see `Mahjong.Rules.Tests.log` and `Mahjong.Server.Tests.log` under `artifacts/lantern-hall-core/`. The exact published build passed **86 Chromium/WebKit tests** and offline SQLite restore. A separate Production smoke also passed. The smoke logs and live desktop/landscape measurements are under `artifacts/lantern-hall-final/`.

## Touch and geometry

The browser gate runs Playwright 1.65.1 with **Chromium 159.0.8154.6** and **WebKit 27.2**. The touch cases use mobile viewport and touch emulation at device scale factor 1. Actual notches, mobile Safari and Chrome with browser chrome or soft keyboards, hardware audio, and screen-reader output still need device checks. The coordinates and sizes below are measurements from the earlier landscape run on Ubuntu 26.04.1 LTS, not from the later visual passes.

- At **390×780, 393×780 and 430×780 CSS pixels**, tap the four corners (2 px inside) and center of all 13 pre-draw tiles, 14 post-draw tiles, and 18 physical four-kong fixture tiles. A draw retains existing DOM nodes. Every tap is checked against a new native touch event, its target, and the absence of a discard. The `Discard` button is the only commit. Browser touch-target adjustment may select an adjacent tile in the tiny gap between targets; it never discards.
- At **360×800 → 800×360**, check the projected corners and four lane markers with simulated top/right/bottom/left insets of **10/22/13/25 px**. Tap all 18 four-kong tiles at **800×360** and **740×320** with the same insets. At 740×320 the earlier four-kong rack ended at **y=282.78** and confirmation at **y=299**, inside the **y=307** safe bound. A separate dealer fixture checks all 14 tiles and the long `Discard 9 characters` label on the same short viewport; the compact regression checks that wrapping the confirmation does not move the rack.
- The real human/three-bot test uses four layouts on the same committed turn. At inset **800×360** and **740×320**, the projected board is about **520 px** and **451 px** wide, and the selected rack ends at **y=335.69** and **y=296.69**. At **667×320** without insets the rack ends at **y=288.69**. At **800×360** without insets, document height is **360 px**. The test checks safe bounds and untransformed **44×44 CSS px** minimum targets, touches and releases a real legal tile without scrolling or sending a command, then taps the explicit confirmation and verifies the exact command, acknowledgment, and removed tile. Very narrow viewports or longer choice lists can still use normal page scrolling.
- Added kongs have distinct, vertically stacked hit targets, not overlapping touch regions. The board is the only projected surface. A historical CSS mutation disabling native tile pointer events failed the 390 px check; the first landscape candidate failed the live 740×320 gate when its dealer label pushed the rack below the safe bound.

## Desktop and motion coverage

- The desktop fixture checks **1280×720, 1440×900 and 1920×1080** with keyboard input: a projected table at least 80% of viewport width, all four seat labels, a single 14-tile row, and a separate `Discard` control, without page overflow. `End` and `Enter` focus and select a tile without discarding. The art fixture checks that all 27 suited faces paint from one passive, same-origin sheet, with no request for it on the landing screen.
- The motion spec drives controlled snapshots through the client. It samples actual deal, draw and discard travel, checks that taps still select and confirm once, and checks distinct call stamps and two seat-local wins at **740×320** with simulated insets. Other cases check immediate state and feedback with reduced motion, and that pause, hiding, resizing and reconnect clear effects rather than replaying them.
- Separate lane evidence: the desktop lane's Chromium capture from a native publish at **1440×900** shows a roughly **1,352 px** wide projected table with readable rivers and traditional suited faces, a flat 14-tile rack and a separate **44 px** high confirm button. The Effects lane's earlier native-server captures show backed deal packets and a public discard in Chromium and WebKit. Its controlled portrait and compact-landscape captures also show the turquoise draw, a Peng burst, and two separately anchored win stamps with signed scores. These captures are from the individual lanes, not a combined run or a frame-rate measurement.

## Table depth and seat actors

- The [depth fixture](../web/e2e/depth.spec.ts) sweeps **1440×900** and inset **740×320** with motion disabled. It compares raised river tops and the stacked wall to the same scene with tile height set to zero, checks that the river footprints and rack do not move, and isolates wall and river facets in screenshots to verify they paint.
- The [actor fixtures](../web/e2e/effects.spec.ts) sample all four compact discard reaches, the desktop call, and distinct winner and loser poses. They check that the cast does not move or block controls, that a briefly delayed actor chunk can still play a fresh commit, and that resync and reduced motion leave still poses. A WebKit capture from the separate native Production actor build is retained at `artifacts/depth-actors-final/review/webkit-live-reach.png`; it is not a combined browser result.

## Lantern Hall behavior

- The lazy `actors` JS and CSS carry the original Hall lamps, screen, inlaid felt and circular dial. The dial shows the wind, timer and wall count without accepting input. **Roll for Kong** is offered only for a server-legal ready-hand Gang; after commit, the replacement turn displays the two dice as pips and the lower die from the server. Bu (Supplement) does not roll.
- **Chow** is the English label for `chi`. The same server seat order now displays counterclockwise from the viewer: near → right → far → left. The immediate successor alone can Chow, and sees that discard on their left.
- With motion enabled, an eligible live win plays a controlled **520 ms** lantern scene with light relayed from the winning seats. It does not delay scores or replay on sync or reconnect. Results show each winner's complete server-projected hand, including concealed meld faces, with the winning event tile separate. Settlement reveals no additional concealed tiles from non-winners, and the winner review does not depend on motion or the art chunk.
- **Settings** offers **Enter full screen** / **Exit full screen** where the browser supports the Fullscreen API. It is optional; unsupported browsers keep playable windowed layouts and show a fallback message.

## Live coverage and pacing

**Earlier depth and seat-actor publish:** `artifacts/depth-actors-final/publish/` passed **52/52** browser cases (**26 Chromium + 26 WebKit**, fixtures and live play). Its offline restore recovered the original guest, preferences, paused game and committed action without replay. A separate coordinator run in Production also booted and verified restore. Live Chromium play at **1440×900** and **740×320** recorded two explicit discards per viewport, no scroll overflow, and cast JS/CSS loaded only after leaving the landing page. The app ships original media apart from the [CC0 suited tile marks](assets.md), with no reference clips. See `smoke.log`, `live/measurements.json` and `budget.json` under `artifacts/depth-actors-final/`.

To replay that earlier artifact with the pinned .NET runtime, run from the checkout root for local play only (no external deployment):

```sh
dotnet artifacts/depth-actors-final/publish/Mahjong.Server.dll --urls http://127.0.0.1:8080
```

**Earlier combined desktop, tile-art and motion publish (2026-11-20, before depth and actors):** The smoke for `artifacts/prototype/desktop-cartoon-check/publish/` logged **38/38** passing cases, **19 Chromium + 19 WebKit**, covering the fixtures and live browser play. The native smoke then verified health, version, static assets and WebSocket admission, paused after a legal choice, and recovered the original guest, preferences, paused game and committed action from the offline restore without replaying it. See `artifacts/prototype/desktop-cartoon-check/smoke.log`.

**Earlier landscape publish (2026-11-20):** **18/18** cases passed, **9 Chromium + 9 WebKit**, against `artifacts/prototype/landscape-publish/`. This was a dirty-tree build based on `bb14458`; `/api/version` reported `0.1.0`, protocol `1`, and revision `unknown`. After the browsers, the smoke seeded a disposable room, made a real choice, paused, and stopped. The new server process on the offline restore recovered the original cookie identity, preferences, exact room/seat checkpoint, and existing command receipt without applying the choice again.

The live tests cover public discovery and retry, private invite admission, two humans plus two bots, a three-bot table, persisted preferences, literal-text chat, pause/resume, stale-room recovery, original-lease retry, and native `4001` tab takeovers. One-hand rematch and a full four-hand match run in each engine; each `Next hand` keeps the totals and follows the server’s next dealer. The test server uses fresh seeds, a **100 ms** bot delay and **30 s turn / 8 s claim** clocks. Both engines observed a projected **30 s** turn in the earlier landscape run. A raw first touch in the real client checks audio unlock without an explicit Sound test action; a separate earlier Production launch in both engines verified first-keyboard-gesture unlock. The renderer fixture separately checks the discard, last-tile and Kong Cannon river markers, added-kong robbery, call and settlement feedback, reduced motion, and audio cue replacement and mute.

**Historical baseline (2026-11-19):** **14/14** browser cases after the server takeover-close fix; a separate **2/2** on a Production host with the default **700 ms** bot delay and **100 ms** server tick. Those results predate the later visual passes. Not every rare action occurs in live samples; deterministic rare cases belong to the [Rules tests](rules.md#reducer-projections-and-verification).

## Asset and feedback budget

The frozen Lantern Hall package measures **32,613 gzip bytes** cold, including the favicon, 155 bytes below the **32 KiB** budget. Full play is **58,214 bytes**, plus **638 bytes** for the optional Settings Fullscreen chunk (**58,852 bytes** for all static assets). The Hall and cast load as deferred JS and CSS when entering the table or its waiting room, and the suited-face SVG loads at the first marked face. These are same-origin assets; no font files, audio recordings or video are fetched. The earlier depth and seat-actor build measured **32,682 bytes** cold (86 bytes below budget) and **50,087 bytes** for the full table. The **30,634-byte** cold and **42,429-byte** full-table estimates are historical, from the desktop, tile-art and motion pass before depth and actors. See [asset provenance and the budget breakdown](assets.md#static-asset-budget) for these per-file gzip estimates, not HTTP transfer measurements.

Committed snapshots place tiles, choices, and scores immediately. On a continuous live start or next hand, four staggered gold-trail packets of tile backs travel from the far wall toward the rack. A turquoise draw flies from a side wall to the isolated local draw slot. An orange discard flies from the local tile's former position (or another player's seat label) to that player's river. Chow, Peng, Kong, Supplement and opening reveals get distinct seat-anchored stamps; wins add a burst at each winning seat, with gains rising and losses dropping. These are decorative overlays, not moving hit targets or a replay of the hidden wall.

The original Fox, Rabbit, Tanuki and Dragon sit beside the tilted CSS table in a decorative layer that cannot intercept taps. A committed discard prompts a wind-up and reach toward the public river tile; a call points, winners raise their arms, and seats with a negative settlement and no win slump. Their body, head, upper arms, forearms and wrists articulate separately. The cast reacts to committed updates; it does not change legal choices, turns or scoring.

The automatic results dialog may wait 540 ms for live score feedback; the scores and `Hand results` or `Match results` button are already available. OS or saved reduced motion skips the flights, bursts, gestures and lead-in while retaining still poses, call labels and immediate results. Initial sync and reconnect do not replay missed motion. Web Audio synthesizes the cues, waits for a trusted gesture, and suppresses stale effects across reconnect, mute, and backgrounding.

The supplied B1–B4 contact sheets show a shallow angled board, a prominent near rack, edge seats, and compact center/score feedback; the Y1 sheet shows a landscape table inside a portrait video frame. These stills informed composition, not the cast's choreography, timings, sound or rules. The cues are original, and the only rules profile is the source-based [Changsha contract](rules.md).

The earlier desktop, tile-art and motion publish and smoke evidence remain at `artifacts/prototype/desktop-cartoon-check/`; the landscape screenshots, geometry and live-decision JSON, smoke output, and checksums remain at `artifacts/prototype/landscape-evidence/`. These are local validation artifacts, not bundled browser content.

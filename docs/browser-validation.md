# Browser validation

## Reproduce

Build the client with `npm --prefix web ci` and `npm --prefix web run build`, then [publish the real server](operations.md#verify-a-build) with those assets. Install the locked Playwright browsers (`npm --prefix web exec -- playwright install chromium webkit`; provide their OS libraries as needed). Set `publish`, `version`, and `revision` to the artifact path and embedded identity, then run the same browser and persistence smoke as CI:

```sh
ASPNETCORE_ENVIRONMENT=Testing Mahjong__Testing__BotDelayMilliseconds=100 \
  Mahjong__Testing__TurnSeconds=30 Mahjong__Testing__ClaimSeconds=8 \
  MAHJONG_GEOMETRY_PORT=46144 \
  bash scripts/smoke-published.sh "$publish" "$version" "$revision" --with-browser
```

The smoke starts a loopback host and uses disposable data; its restart test restores an offline archive into a fresh directory. Set `MAHJONG_GEOMETRY_PORT` to a free port (default `4179`) for the separate Vite fixture. `npm --prefix web run test:geometry` runs just that fixture, which has no room API or WebSocket. The live specs use real TCP/HTTP/WebSocket connections, independent guest cookies, and SQLite. The transport test delays one actual stale command and drops one already-committed acknowledgement; it injects no game snapshots or choices.

To try the frozen local prototype at [http://127.0.0.1:8080](http://127.0.0.1:8080), run from the checkout root with the .NET 10 runtime:

```sh
umask 077
data="$PWD/artifacts/prototype/landscape-local-data"
(cd artifacts/prototype/landscape-publish &&
  Mahjong__DataDirectory="$data" dotnet Mahjong.Server.dll --urls http://127.0.0.1:8080)
```

## Touch and geometry

Validation ran on Ubuntu 26.04.1 LTS with Playwright 1.65.1: **Chromium 159.0.8154.6** and **WebKit 27.2**. Both used mobile viewport and touch emulation at device scale factor 1. Actual notches, mobile Safari and Chrome with browser chrome or soft keyboards, hardware audio, and screen-reader output still need device checks.

- At **390×780, 393×780 and 430×780 CSS pixels**, tap the four corners (2 px inside) and center of all 13 pre-draw tiles, 14 post-draw tiles, and 18 physical four-kong fixture tiles. A draw retains existing DOM nodes. Every tap is checked against a new native touch event, its target, and the absence of a discard. The `Discard` button is the only commit. Browser touch-target adjustment may select an adjacent tile in the tiny gap between targets; it never discards.
- At **360×800 → 800×360**, check the projected corners and four lane markers with simulated top/right/bottom/left insets of **10/22/13/25 px**. Tap all 18 four-kong tiles at **800×360** and **740×320** with the same insets. At 740×320 the four-kong rack ends at **y=282.78** and confirmation at **y=299**, inside the **y=307** safe bound. A separate dealer fixture keeps all 14 tiles and the long `Discard 9 characters` label in view on the same short viewport.
- The real human/three-bot test uses four layouts on the same committed turn. At inset **800×360** and **740×320**, the projected board is about **520 px** and **451 px** wide, and the selected rack ends at **y=335.69** and **y=296.69**. At **667×320** without insets the rack ends at **y=288.69**. At **800×360** without insets, document height is **360 px**. The test checks safe bounds and untransformed **44×44 CSS px** minimum targets, touches and releases a real legal tile without scrolling or sending a command, then taps the explicit confirmation and verifies the exact command, acknowledgment, and removed tile. Very narrow viewports or longer choice lists can still use normal page scrolling.
- Added kongs have distinct, vertically stacked hit targets, not overlapping touch regions. The board is the only projected surface. A historical CSS mutation disabling native tile pointer events failed the 390 px check; the first landscape candidate failed the live 740×320 gate when its dealer label pushed the rack below the safe bound.

## Live coverage and pacing

**Current landscape publish (2026-11-20):** **18/18** cases passed, **9 Chromium + 9 WebKit**, against `artifacts/prototype/landscape-publish/`. This is a dirty-tree build based on `bb14458`; `/api/version` reported `0.1.0`, protocol `1`, and revision `unknown`. After the browsers, the smoke seeded a disposable room, made a real choice, paused, and stopped. The new server process on the offline restore recovered the original cookie identity, preferences, exact room/seat checkpoint, and existing command receipt without applying the choice again.

The live tests cover public discovery and retry, private invite admission, two humans plus two bots, a three-bot table, persisted preferences, literal-text chat, pause/resume, stale-room recovery, original-lease retry, and native `4001` tab takeovers. One-hand rematch and a full four-hand match run in each engine; each `Next hand` keeps the totals and follows the server’s next dealer. The server uses fresh seeds, a **100 ms** test bot delay and **30 s turn / 8 s claim** clocks. Both engines observed a projected **30 s** turn. A raw first touch in the real client verifies audio unlock without an explicit Sound test action; a separate Production launch in both engines verified first-keyboard-gesture unlock. The renderer fixture separately checks the discard, last-tile and Kong Cannon river markers, added-kong robbery, call and settlement feedback, reduced motion, and audio cue replacement and mute.

**Historical baseline (2026-11-19):** **14/14** browser cases after the server takeover-close fix; a separate **2/2** on a Production host with the default **700 ms** bot delay and **100 ms** server tick. Those are not results for the current landscape publish. Not every rare action occurs in live samples; deterministic rare cases belong to the [Rules tests](rules.md#reducer-projections-and-verification).

## Asset and feedback budget

The landscape publish has four web files: HTML, `index--yQG1nob.js`, `index-B-rlgBZL.css`, and the [original favicon](assets.md), `lantern-BX9IuL5Y.svg`. Measured total: **82,026 bytes raw / 27,286 bytes gzipped** (sum of per-file Node 26 `gzipSync` results), within the **32 KiB** first-load budget. This is a compressed size estimate, not an assertion that the native host sends gzip. No runtime fonts or media are fetched.

Committed snapshots place tiles, choices, and score changes immediately. The 210–420 ms live arrival and score animations move decorative faces and badges, not hit boxes. The automatic results dialog may wait 540 ms to let the score feedback show; the scores and Results button are already available, and reduced motion and reconnect do not replay the animation. Web Audio synthesizes the cues, waits for a trusted gesture, and suppresses stale effects across reconnect, mute, and backgrounding. There are no queued deal sequences or WebGL fallbacks.

The supplied B1–B4 contact sheets show a shallow angled board, a prominent near rack, edge seats, and compact center/score feedback; the Y1 sheet shows a landscape table inside a portrait video frame. These stills informed composition, not the timings, sound, or rules. The cues are original, and the only rules profile is the source-based [Changsha contract](rules.md).

Local Playwright screenshots, geometry and live-decision JSON, the smoke output, and artifact SHA-256 checksums are retained at `artifacts/prototype/landscape-evidence/`. They are evidence, not published app content.

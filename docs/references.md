# Reference and observation ledger

Recorded **2026-11-19 UTC**. The four video references were checked in logged-out Chromium using their ordinary public pages and visible player controls. Playback diagnostics and directly inspected visual samples are separate below. Still samples do not establish continuous feature coverage. No accounts, direct stream retrieval, barrier circumvention, or archived media were used.

## Access and source metadata

Times in the access table are UTC on 2026-11-19. Values after `@` are the video-element playback position, not a feature observation.

| Clip | Initial curl GET (page only) | Ordinary primary page in Chromium | Same-ID alternate in Chromium |
|---|---|---|---|
| B1 | `22:34:11.249776710Z` HTTP 200 | `22:48:38.377Z` HTTP 200, 88 decoded frames @ 7.654 s | `22:48:46.874Z` HTTP 200, 99 frames @ 8.033 s |
| B2 | `22:34:11.244325307Z` HTTP 200 | `22:48:38.384Z` HTTP 200, 172 frames @ 10.477 s | `22:48:49.499Z` HTTP 200, 137 frames @ 9.271 s |
| B3 | `22:34:11.235359322Z` HTTP 200 | `22:48:36.021Z` HTTP 200, 45 frames @ 6.215 s | `22:48:46.960Z` HTTP 200, 85 frames @ 7.553 s |
| Y1 | `22:34:12.419291057Z` HTTP 200 | `22:48:34.950Z` HTTP 200, 136 frames @ 5.442 s | `22:48:47.930Z` HTTP 200, 137 frames @ 5.507 s |

Alternate forms, separate from the 28-entry library: B1 <https://www.bilibili.com/video/BV15PwzehEd3/>, B2 <https://www.bilibili.com/video/BV1kgNPenEzG/>, B3 <https://www.bilibili.com/video/BV1DYF5e2EJT/>, Y1 <https://www.youtube.com/watch?v=2DzM-MX4h5Q>. The Bilibili alternate browser samples in the table landed on their respective `/en/video/…/` page. No different video ID was used as evidence for a reference.

- A separate plain HTML read of both Bilibili forms returned **HTTP 412** with the page title `出错啦! - bilibili.com`: B1 primary/alternate `22:41:11.467991Z` / `22:41:11.480367Z`, B2 `22:41:11.509874Z` / `22:41:11.529354Z`, B3 `22:41:11.469615Z` / `22:41:11.468777Z`. This is a fetch failure, not a browser playback verdict. Y1's two HTML reads returned HTTP 200 at `22:41:12.390580Z` / `22:41:12.715424Z`.
- In Chromium, the Bilibili opening displayed `Login Enjoy HD Videos for Free` and `30-second preview`; all three continued to approximately 35 s in fresh logged-out tabs and to at least 65 s in an ordinary tab. The banner was not a hard 30 s cutoff in these runs. B2's initial click timed out (`TimeoutError: locator.click: Timeout 1500ms exceeded.`) on both forms, but frames advanced without it.
- Late B1 and B3 played near the end and then auto-advanced to different IDs by `22:53:34.060Z` and `22:53:33.177Z`, respectively. The original `ended` wait timed out (`TimeoutError: page.waitForFunction: Timeout 12000ms exceeded.`); neither incoming video was counted. B2's late attempts produced `TimeoutError: locator.boundingBox: Timeout 30000ms exceeded.` at `22:53:49.104Z`, `TimeoutError: locator.click: Timeout 3500ms exceeded.` at `22:54:35.049Z`, and `Error: Public seek bar is not visible` at `22:55:39.896Z`. These were control failures, not media decode errors or proof of a gated interval.

| Clip | Publication date (source) | Duration (source) | Variant confidence |
|---|---|---|---|
| B1 | 2025-01-19 (Bilibili page date) | `02:51` / 171 s (player UI / `video.duration`) | High confidence in the displayed `血战麻将·换三张` mode label and `定缺` prompt; page calls it Happy Mahjong, Battle to the End. Not evidence of Changsha rules. |
| B2 | 2025-02-04 (Bilibili page date) | `02:19` / 139 s (player UI / `video.duration`) | Same visible mode label and `定缺` prompt as B1. The source title claims a last-tile win; the sampled footage does not establish that result. |
| B3 | 2025-01-30 (Bilibili page date) | `03:38` / 218 s (player UI / `video.duration`) | High confidence in the displayed `红中血流` mode label and red-center tile; uploader description also identifies a red-center mode. No Changsha identification. |
| Y1 | `2023-01-31T22:53:59-08:00` (watch-page `datePublished`, verified `22:53:44.766639Z`) | `PT0M16S` (HTML `meta[itemprop=duration]`); 15.041 s actual `video.duration` | The title labels it Mahjong Soul. The blue table and in-game overlays do not establish the rules or particular mode. |

## 1× playback recheck and storyboard coverage

The four ordinary logged-out tabs started in parallel at `23:00:33.458Z`–`23:00:33.462Z`, 2026-11-19; all returned HTTP 200. No seeks or speed changes were issued. Bilibili's own player jumped from startup to `00:05.089` in each tab, so the first five seconds are unverified. Y1 started at zero. The stills below were inspected, not inferred from decode counts; no continuous visual claim is made between frames.

| Clip | Initial 1× run: last state (UTC) | Ordinary replay: actual cutoff observed (UTC) | Primary storyboard stills, media seconds |
|---|---|---|---|
| B1 | Paused at `01:06.908` (`23:01:58.157Z`); did not end | Paused at `01:05.992` under login dialog (`23:04:37.416Z`) | 6.620, 7.614, 10.103, 13.124, 16.017, 20.034, 24.060, 28.096, 32.003, 40.086, 48.030, 56.093, 64.030 |
| B2 | Paused at `01:05.859` (`23:01:56.379Z`); did not end | Paused at `01:05.978` under login dialog (`23:04:36.908Z`) | 5.104, 7.545, 10.050, 13.053, 16.050, 20.066, 24.063, 28.069, 32.087, 40.046, 48.002, 56.085, 64.043 |
| B3 | Paused at `01:07.412` (`23:01:58.432Z`); did not end | Paused at `01:05.958` under login dialog (`23:04:36.945Z`) | 6.823, 7.561, 10.069, 13.080, 16.078, 20.098, 24.004, 28.029, 32.059, 40.096, 48.028, 56.098, 64.040 |
| Y1 | Completed one loop of 15.041 s: `14.940 → 0` at `23:00:53.384Z` | No cutoff | 0.172, 1.043, 1.896, 2.864, 4.087, 5.211, 6.435, 7.652, 8.883, 10.119, 11.337, 12.556, 13.770, 14.739 |

The replays reproduced an actual paused player behind **`Scan QR Code to Login`** (`Please use Bilibili client`, `Password login`, `SMS Login`); no explicit public continue control was found. This is separate from the earlier 30-second banner and from seek-control errors. The logged-out run could not continue through B1's `[01:05.992, 02:51)`, B2's `[01:05.978, 02:19)`, or B3's `[01:05.958, 03:38)` tails. The earlier ordinary seek stills for B1/B3 below remain valid but do not fill those intervals or show uninterrupted completion. No login or workaround was attempted.

### Observation and inference log

Window endpoints below are *sample times*: a change between two stills is bounded by the pair, not timed to the intervening frame or attributed to a tap.

| Clip and media time | Directly observed | Inference / limit |
|---|---|---|
| B1 `00:06.620–00:13.124` | Tilted teal plane, faces at bottom and backs on three edges; `定缺中` at first, then center timer and a loose tile. | Opening-to-play display transition; initial dealing and choice input not observed. |
| B1 `00:24.060–00:32.003`, `01:04.030` | Offset end tile, raised tile at `00:28.096`, changed river by `00:32.003`. At `01:04.030` a far-side `+1200` and three `−400` badges. | Selection and scoring feedback cues, not click/claim causality or a final settlement record. |
| B1 `01:16.738`, `02:08.250`, `02:47.823` (earlier seek stills) | Separated groups; `杠`/`碰`/`过` buttons and red `胡`; near-end view partly covered by the player speed menu. | These labels do not establish a claim order, kong method, or closing settlement. |
| B2 `00:05.104–00:13.053` | `定缺中` with a full bottom rack, then center count and gold-marked river tiles. | Opening-to-play feedback; no lobby, deal or full selection motion observed. |
| B2 `00:20.066–00:28.069`, `01:04.043` | Gold/blue `碰` effect is visible at `00:24.063`, and a separate face-up lower-right group persists; late accessible still shows developed rivers and an isolated end tile. | Visible call feedback and meld separation; advertised last-tile win and close-out remain unverified. |
| B3 `00:06.823–00:16.078` | Green-backed exchange groups and `换牌中`, then three suit circles, then waiting text/count; red-center tile visible in the rack. | Mode-specific exchange and suit choice, not Changsha rules. |
| B3 `00:20.098–00:24.004`, `00:48.028–00:56.098` | `碰` flash and separated face-up group; `+3000` and three `−1000` badges at `00:48.028`; `自摸` flash at `00:56.098`. | Meld, point and self-draw feedback are visually established; the score formula/sequence is not. |
| B3 `01:37.829`, `02:43.500`, `03:34.960` (earlier seek stills) | `自摸` overlay, later `+1000`/`−1000` point badges and a black outro card. | Outro is video content. Full score settlement and the gaps before the card are not audited. |
| Y1 `00:00.172–00:06.435`, `00:10.119–00:14.739` | Wide blue game table in portrait crop, four discard directions, face-up local rack. On-screen hand at `00:06.435` and `00:13.770`; offset end tile and two-part number at `00:11.337–00:12.556`. Last sample remains at the table. | No physical touch, complete claim or end scoreboard established, even though the clip looped. |

**Audio:** All four streams produced nonzero decoder-byte counts; there was no listening/perceptual audio evidence, so cues, music and voice remain unclassified. For full storyboard and audio verification of the Bilibili tails, please provide authorized complete files or playable links with sound. No matching game, reproduced asset, or visual fidelity is claimed.

## Cross-video feature and implementation matrix

`—` means not established by the samples, not absent. B1, B2, and B3 are co-primary visual references; Y1 is supporting context. The shared cues are layout conventions, not evidence that the references share a ruleset or that the implementation matches any clip.

| Cue | B1 | B2 | B3 | Y1 | Chosen treatment and implementation status |
|---|---|---|---|---|---|
| Entry and opening | Suit choice/wait | Suit-choice wait | Exchange, then suit choice | Already mid-hand | Lobby/deal/reset not established for any clip. App has its own guest/lobby/start/rematch flows; only the Rules engine's actual Changsha opening choices appear in the action bar. No copied opening rules. |
| Four sides and camera | Teal fixed tilt | Teal fixed tilt | Teal fixed tilt | Pitched blue board inside portrait video | All show four directions. Current client uses a DOM [board plane](../web/src/table.ts) with [CSS](../web/src/styles.css) `perspective(1000px) rotateX(28deg)`, decorative depth and four projected corner markers. Original felt, border and tile art, not a WebGL or camera match. |
| Seat and tile visibility | Faces at bottom, green backs on other edges, seat badges | Same arrangement | Same; visible red-center face and extra groups | Bottom faces, other edges backed or in separate groups | `TableView` maps the viewer to bottom; left/far/right use seat-local lanes, current/dealer/presence labels, opponent back counts, and separate walls. Only the player's hand is in the wrapping rack; concealed faces and wall order are not sent. |
| Draw / selection / discard | Isolated end tile, raised tile, highlighted central tile | Changing rivers and marked tile | Displaced tile, marked central tile | Offset end tile; hand graphic, no input evidence | Implemented flat 44 px tile buttons, drawn tile marked and spaced, tap to select plus explicit **Discard**. Four ordered `.river` lists, newest eligible discard highlighted, public trigger by the wall counter. Motion limited to a short arrival fade and respects reduced motion. |
| Meld / claim | `杠`/`碰`/`过` controls, separated groups | `碰` flash and separated lower-right group | `碰` effect, distinct face-up groups | Groups visible; individual claim not established | `.choice-list` presents server-legal actions with face previews and a deadline; it sends an opaque option ID, never a face. Distinct groups show source, four backs for concealed kong, and a raised fourth tile for added kong. Modal effects, claim order and timing are not derived from clips. |
| Result and close-out | `胡` and signed point effects; final summary unverified | Last-tile win in title only; tail gated | `自摸` and signed point effects; prior late still has a separate video outro | Numeric overlay; no verified result screen | Implemented [results dialog](../web/src/screens.ts) uses server truth: win/draw, per-seat deltas and totals, winning faces/patterns, birds and actual transfers, then next hand or rematch. No clip-based payout inference or recreated video outro. |
| Touch and sound | Touch/audio not established | Touch/audio not established | Touch/audio not established | Graphic hand is not physical touch; audio not audited | Wrapped untransformed rack and short-landscape side layout are implemented. Original synthesized [cues/music](../web/src/audio.ts) are preference-controlled; no reference-audio match. Browser touch is tested, not physical-device proof. |

**Product verification:** Rules passed [55 locked Release tests](rules.md) (expanding the earlier 52-pass baseline); Backend passed 8 locked Release tests. Published WebSocket/SQLite backup-restore and loopback TLS/WSS passed. The [final browser qualification](browser-validation.md) passed 14/14 on real Testing hosts in Chromium 159.0.8154.6 and WebKit 27.2, plus 2/2 representative default-pacing cases against a separate Production host. The licensed native publish independently passed 14/14 and recovered a paused checkpoint, guest preferences and an original command receipt. An earlier published rerun was 13/14 after an intermittent 430 px Chromium geometry tap miss (all live tests passed). Geometry uses a synthetic rare four-kong fixture; live matches use fresh seeds. These checks cover emulated browser touch, not physical devices, reference fidelity or OCI execution.

## Supplied library (28 exact forms)

Listed 2026-11-19. Only the four video entries have playback observations here. The other references are pointers, not claims of review, compatibility or asset permission.

**Primary / supporting video (4)**

1. B1: <https://www.bilibili.com/en/video/BV15PwzehEd3/>
2. B2: <https://www.bilibili.com/en/video/BV1kgNPenEzG/>
3. B3: <https://www.bilibili.com/en/video/BV1DYF5e2EJT/>
4. Y1: <https://www.youtube.com/shorts/2DzM-MX4h5Q>

**Rules (5)**

5. <https://www.themahjongproject.com/how-to-play/basics>
6. <https://mahjongpros.com/blogs/how-to-play/beginners-guide-to-changsha-mahjong>
7. <https://www.reddit.com/r/Mahjong/comments/xp6crv/better_know_a_variant_changsha_mahjong_%E9%95%BF%E6%B2%99%E9%BA%BB%E5%B0%86/>
8. <https://baike.baidu.com/en/item/Changsha%20Mahjong/36618>
9. <https://baike.baidu.com/en/item/Changsha%20Mahjong/36618#2>

**Asset pointers (3)**

10. <https://codeberg.org/amenoasa/mahjong_assets>
11. <https://github.com/FluffyStuff/riichi-mahjong-tiles>
12. <https://sketchfab.com/3d-models/mahjong-tile-custom-design-2b148b418677495487fc60009ca241e7>

**Visual (6)**

13. <https://github.com/ArcturusZhang/Mahjong>
14. <https://github.com/YeeKal/mahjong-online>
15. <https://mahjongo.com/chinese>
16. <https://pomax.github.io/mahjong/>
17. <https://themahjong.com/>
18. <https://www.reddit.com/r/Mahjong/comments/1dbot29/html_and_css_mahjong_display_code/>

**Implementation (6)**

19. <https://github.com/long2know/mahjong-autotable>
20. <https://github.com/pwmarcz/autotable>
21. <https://pwmarcz.pl/autotable/>
22. <https://pwmarcz.pl/autotable/about.html>
23. <https://pwmarcz.pl/blog/autotable/>
24. <https://github.com/tomowatt/unity-docker-example>

**Deployment (4)**

25. <https://mahjong.long2know.com>
26. <https://mahjong.long2know.com/autotable/>
27. <https://games.long2know.com/mahjong>
28. <https://games.long2know.com/mahjong/>

## Supplemental supplied URLs (2026-11-20 UTC)

- B4, new supporting reference: <https://www.bilibili.com/en/video/BV19bPXeBExV>
- B3, alternate URL for the **same video**, not independent evidence: <https://www.bilibili.com/en/video/BV1DYF5e2EJT>

B1, B2 and B3 remain co-primary. Both exact forms opened in parallel at `04:07:51.083Z`–`04:07:51.085Z` in fresh logged-out Chromium contexts. Both redirected to the same ID with a trailing slash and returned HTTP 200. An early Play click timed out on both (`TimeoutError: locator.click: Timeout 750ms exceeded.`), but 1× playback started without it. The player set its initial position to `00:05.089`; the “30-second preview” banner was not a hard cutoff in either run.

| Clip | Final URL / duration | Confirmed 1× playback and missing coverage |
|---|---|---|
| B4 | `https://www.bilibili.com/en/video/BV19bPXeBExV/` (`04:07:52.803Z`); initial player duration 32 s, final media duration **31.699 s** | First decoded at `00:05.100`, natural `ended` at `00:31.699` (`04:08:20.645Z`), still on B4. No login cutoff or media error. `[00:00.000, 00:05.100)` remains unverified: the visible rewind control briefly showed `00:00.040` without ready frames at `04:10:46.919Z`, then the player returned to `00:05.108` before a new frame could be inspected. |
| B3 | `https://www.bilibili.com/en/video/BV1DYF5e2EJT/` (`04:07:52.756Z`; exact repeat `04:10:44.046Z`); **218 s** (`video.duration`) | Exact-form repeat decoded from `00:05.089` to `01:07.047`, when playback paused under **Scan QR Code to Login** (`04:11:47.526Z`). The ordinary `/video/BV1DYF5e2EJT/` fallback returned HTTP 200 (`04:10:43.695Z`), later landed on the same `/en/` page and played `00:05.092–01:06.247` before the same dialog (`04:11:49.873Z`). No public continue control found or media error reported. Missing continuous intervals on the exact-form run: `[00:00.000, 00:05.089)` and `[01:07.047, 03:38.000)`. **No material change** from the earlier B3 cutoff; the previous late stills do not fill the tail. |

B4's Bilibili page date is 2025-02-03. It labels the clip a WeChat Happy Mahjong mini-game, tags “Blood Battle to the End” and “Change three,” and describes three consecutive shots. This is medium-confidence variant metadata, not verification of the calls or Changsha rules. B3's `红中血流` label was visible again; this confirms its identification, not an additional variant example.

### Supplemental visual observations and candidate treatment

B4's 17 inspected stills (media seconds) were `5.100, 5.241, 6.835, 8.260, 10.044, 12.588, 14.056, 15.098, 18.051, 21.578, 22.098, 25.059, 27.060, 28.526, 29.030, 30.064, 30.992`. The clip was already mid-hand at the first inspected frame; the final frame sample was an outro, not a results screen. The gaps between stills are not visual coverage.

| B4 sample bounds | Direct visual evidence | Comparison / candidate only |
|---|---|---|
| `00:05.100–00:06.835` | Tilted teal table, four closely packed discard rows around a small central timer, end-on tile runs at the edges, and separated face-up groups beside the bottom rack. | Reinforces B1–B3's fixed viewpoint and separation of rack, groups and rivers. Candidate: check dense-river legibility without reducing local tile targets. |
| `00:08.260–00:12.588`, `00:25.059–00:27.060` | Two gold rings appear in one still, then separate far/right `胡` marks. Later a left gold ring and then a left `胡` mark appear while the earlier marks remain. | B3 shows transient win effects; B4 also shows persistent seat-local marks with the table still visible. Candidate: distinct, restrained feedback for authoritative seat events. These stills do not show whether wins shared a discard or establish scoring order. |
| `00:14.056–00:22.098`, `00:27.060–00:30.992` | A marked offset tile and a brief white tile-info panel; later the table cuts to a black, red-heart end card by `00:28.526`. No final in-game scoreboard in the samples. | Like B3's earlier outro still, the end card is video content. Candidate: keep any optional tile info separate from the rack; neither the card nor the panel's game data is a requirement. |

B3's repeat stills corroborated exchange/pass (`00:05.089–00:06.609`), the three suit circles (`00:10.033`), a tile-info panel (`00:25.019`), marked discards (`00:38.005`, `01:00.081–01:04.084`) and seat-local `−800`/`+800` feedback (`00:53.036`). Nothing from this form changes the previous treatment or the client.

Both clips produced nonzero audio-decoder counts, but no sound was listened to or classified. To close the evidence gaps, provide an authorized B3 recording or playable link with sound covering the opening and uninterrupted `01:07.047–03:38.000` tail, and an authorized B4 recording/link with sound that includes the skipped opening. Full files are preferable for timing and audio comparisons.

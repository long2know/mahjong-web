# Lantern Table asset provenance

| What ships | Authorship and location |
|---|---|
| Lantern name, emblem, favicon, controls | Original for this project: [`web/src/lantern.svg`](../web/src/lantern.svg), [`web/src/dom.ts`](../web/src/dom.ts), and [`web/src/main.ts`](../web/src/main.ts). |
| Suited tile marks | [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles/tree/26e127ba2117f45cdce5ea0225748cc0cfad3169/Regular) at `26e127ba2117f45cdce5ea0225748cc0cfad3169`, only `Regular/Man1.svg`–`Man9.svg`, `Regular/Sou1.svg`–`Sou9.svg`, and `Regular/Pin1.svg`–`Pin9.svg`. Both the pinned [README](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/README.md#license) and [LICENSE](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/LICENSE.md) declare the assets public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). |
| Tile bodies, backs, table, wall, lighting and type | Original CSS surfaces in [`web/src/styles.css`](../web/src/styles.css) and layout in [`web/src/table.ts`](../web/src/table.ts). The tilted CSS 2.5D projection sets light, raised tops against shaded parallelogram sidewalls. Ivory and jade bands expose the slab layers; dark feet and contact shadows ground them on the felt. The browser uses its installed system and serif fonts; no font files are bundled. |
| Lantern Hall lamps, screen, felt inlay and circular dial | Original [`hall.css`](../web/src/hall.css) surfaces and [lamp](../web/src/hall-lantern.svg), [room screen](../web/src/hall-room.svg) and [inlay](../web/src/hall-inlay.svg) artwork. The original [dial](../web/src/dial.ts) groups the wind, timer and wall-count display with pips for server-projected dice. |
| Articulated seat characters | Original inline SVG art and pose code for Maple (Fox), Pip (Rabbit), Tallow (Tanuki) and Nori (Dragon) in [`web/src/actors.ts`](../web/src/actors.ts), with original styling in [`web/src/actors.css`](../web/src/actors.css). The body, head, upper arms, forearms and wrists move on committed live discards, calls, wins and losses. |
| Visual effects | Original motion and inline SVG stamp glyphs in [`web/src/effects.ts`](../web/src/effects.ts), with trails, rings and bursts styled in [`web/src/effects.css`](../web/src/effects.css) and placed by [`web/src/table.ts`](../web/src/table.ts). The [win scene](../web/src/finale.ts) uses original lantern and votive art. Deal packets use the original tile backs; draw and discard copies reuse the same CC0 marks as the real tiles. No animation library, sprite images or video assets. |
| Audio cues and quiet table music | Original, procedurally synthesized Web Audio tones and chords in [`web/src/audio.ts`](../web/src/audio.ts). No samples, recordings or third-party music. Audio follows the guest’s saved preferences and stays silent when the browser denies activation. |

The original project assets and code are under [GPL-3.0](../LICENSE); the adapted tile marks are CC0. We kept each suit’s painted geometry, including the calligraphed 萬, the bamboo bird and the coin rosettes. We dropped editor metadata and unused definitions, rounded vector coordinates at tile scale, adjusted the inks for ivory tile bodies, and shared repeated paths as internal fragments. There are no honor, bonus or red-five tiles, upstream code, external SVG references, scripts or fonts.

[`web/src/tile-suits.svg`](../web/src/tile-suits.svg) contains all 27 suited faces: `Man` maps to characters, `Sou` to bamboo, and `Pin` to dots. [`web/src/tile.ts`](../web/src/tile.ts) references each symbol from the same app origin. Vite emits one fingerprinted sheet, first requested when the table renders a marked face. The lazy `actors` JS and CSS carry the cast, Hall artwork, dial and win scene, and load from that origin on entering the table or its waiting room. The Hall SVGs are bundled into the CSS and the characters are inline, not separate image requests. The landing illustration uses original CSS tile backs and the inline lantern emblem and does not request any of these table assets. Settings loads its optional Fullscreen helper separately. The app can serve its artwork without internet access; there are no reference clips, remote asset services or bundled 3D models. The [renderer fixtures](../web/e2e/fixtures/) and Playwright captures are not included in the published app.

## Static asset budget

Use Vite's production `web/dist` and Node 26.13.1 `gzipSync` on each file, then sum the results. Count `index.html`, its entry JS and CSS, and the favicon against the **32 KiB** cold landing budget. Add the lazy `actors` JS and CSS and the same-origin `tile-suits` SVG for full play; count the Settings Fullscreen chunk separately. This estimates compressed static assets, not HTTP transfer size or server compression.

The frozen integrated Lantern Hall package (2026-11-21; `artifacts/lantern-hall-final/budget.json`) is **155 bytes under** the 32,768-byte cold budget.

| Static assets | Raw bytes | Gzip bytes |
|---|---:|---:|
| Cold landing: HTML, entry CSS and JS, and favicon | 98,943 | 32,613 |
| Deferred `actors` JS and CSS, including Hall and dial | 41,219 | 13,806 |
| Deferred CC0 suited-face sheet | 84,694 | 11,795 |
| Full play without the Settings Fullscreen chunk | 224,856 | 58,214 |
| Optional Settings Fullscreen JS | 1,217 | 638 |
| All static assets | 226,073 | 58,852 |

The first combined depth and seat-actor build (2026-11-21) is **historical**; it was **86 bytes under** the 32,768-byte cold budget.

| Historical static assets | Raw bytes | Gzip bytes |
|---|---:|---:|
| Cold landing: HTML, entry CSS and JS, and favicon | 98,735 | 32,682 |
| Deferred `actors` JS and CSS | 15,192 | 5,610 |
| Deferred CC0 suited-face sheet | 84,694 | 11,795 |
| Full table including landing assets | 198,621 | 50,087 |

The following inventory is **historical**: it was measured for the combined desktop, tile-art and motion pass (2026-11-20), before depth and actors.

| Historical static assets | Raw bytes | Gzip bytes |
|---|---:|---:|
| Cold landing: HTML, CSS, JS module and original favicon | 92,438 | 30,634 |
| Deferred table-only CC0 suited-face sheet | 84,694 | 11,795 |
| Full table including landing assets | 177,132 | 42,429 |

Earlier measurements used the same per-file estimate: the landscape publish was 82,026 bytes raw / 27,286 bytes gzip for the full web output before the independent art sheet. The desktop and tile-art pass, before motion, was 81,903 / 26,910 for its shell and 166,597 / 38,705 with the sheet.

Pinned development tools retain their own licenses: Vite 7.3.8 (MIT), TypeScript 5.9.3 (Apache-2.0) and Playwright 1.65.1 (Apache-2.0). The [`vite.config.ts`](../web/vite.config.ts) build emits a modern entry module and deferred `actors` and Fullscreen modules, without bundling Vite's legacy module-preload polyfill or these tools.

[Reference observations](references.md) establish broad presentation cues, not asset rights or fidelity: the four tilted edge lanes and bottom hand are visible in B1 (00:05.100–00:25.003), separated groups and action controls in B1 (01:16.738–02:47.823), and an offset last tile in Y1 (00:02.010–00:12.012). Lantern Table uses its own palette, interface, audio and accessible input geometry, with tile marks from the independent CC0 source above. The WeChat still is observation evidence only; no image from it is copied into the app. The sample clips do not establish this Changsha rules profile, end-to-end rendering parity, or audio equivalence.

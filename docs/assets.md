# Lantern Table asset provenance

| What ships | Authorship and location |
|---|---|
| Lantern name, emblem, favicon, controls | Original for this project: [`web/src/lantern.svg`](../web/src/lantern.svg), [`web/src/dom.ts`](../web/src/dom.ts), and [`web/src/main.ts`](../web/src/main.ts). |
| Suited tile marks | [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles/tree/26e127ba2117f45cdce5ea0225748cc0cfad3169/Regular) at `26e127ba2117f45cdce5ea0225748cc0cfad3169`, only `Regular/Man1.svg`–`Man9.svg`, `Regular/Sou1.svg`–`Sou9.svg`, and `Regular/Pin1.svg`–`Pin9.svg`. Both the pinned [README](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/README.md#license) and [LICENSE](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/LICENSE.md) declare the assets public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). |
| Tile bodies, backs, table, wall, lighting and type | Original for this project: CSS surfaces in [`web/src/styles.css`](../web/src/styles.css) and layout in [`web/src/table.ts`](../web/src/table.ts). The browser uses its installed system and serif fonts; no font files are bundled. |
| Visual effects | Original motion and inline SVG stamp glyphs in [`web/src/effects.ts`](../web/src/effects.ts), with trails, rings and bursts styled in [`web/src/effects.css`](../web/src/effects.css) and placed by [`web/src/table.ts`](../web/src/table.ts). Deal packets use the original tile backs; draw and discard copies reuse the same CC0 marks as the real tiles. No animation library, sprite images or video assets. |
| Audio cues and quiet table music | Original, procedurally synthesized Web Audio tones and chords in [`web/src/audio.ts`](../web/src/audio.ts). No samples, recordings or third-party music. Audio follows the guest’s saved preferences and stays silent when the browser denies activation. |

The original project assets and code are under [GPL-3.0](../LICENSE); the adapted tile marks are CC0. We kept each suit’s painted geometry, including the calligraphed 萬, the bamboo bird and the coin rosettes. We dropped editor metadata and unused definitions, rounded vector coordinates at tile scale, adjusted the inks for ivory tile bodies, and shared repeated paths as internal fragments. There are no honor, bonus or red-five tiles, upstream code, external SVG references, scripts or fonts.

[`web/src/tile-suits.svg`](../web/src/tile-suits.svg) contains all 27 suited faces: `Man` maps to characters, `Sou` to bamboo, and `Pin` to dots. [`web/src/tile.ts`](../web/src/tile.ts) references each symbol from the same app origin. Vite emits one fingerprinted sheet, first requested when the table renders a marked face. The landing illustration uses original CSS tile backs and the inline lantern emblem, so it does not request the sheet. The app can serve its artwork without internet access; there are no reference clips, remote asset services or bundled 3D models. The [renderer fixtures](../web/e2e/fixtures/) and Playwright captures are not included in the published app.

Measured for the combined desktop, tile-art and motion pass (2026-11-20) in Vite's production `web/dist`, using Node 26.13.1 `gzipSync` on each file and summing the results. The motion code and styles are part of the JS and CSS below, not separate downloads. This estimates compressed static assets; it does not measure HTTP transfer size or imply server compression. The **32 KiB** budget applies to the cold landing shell, including the favicon, not to the full table.

| Static assets | Raw bytes | Gzip bytes |
|---|---:|---:|
| Cold landing: HTML, CSS, JS module and original favicon | 92,438 | 30,634 |
| Deferred table-only CC0 suited-face sheet | 84,694 | 11,795 |
| Full table including landing assets | 177,132 | 42,429 |

Earlier measurements used the same per-file estimate: the landscape publish was 82,026 bytes raw / 27,286 bytes gzip for the full web output before the independent art sheet. The desktop and tile-art pass, before motion, was 81,903 / 26,910 for its shell and 166,597 / 38,705 with the sheet. Neither inventory describes the combined build above.

Pinned development tools retain their own licenses: Vite 7.3.8 (MIT), TypeScript 5.9.3 (Apache-2.0) and Playwright 1.65.1 (Apache-2.0). The [`vite.config.ts`](../web/vite.config.ts) build disables Vite's legacy module-preload polyfill; the shipped application is a single modern ES module and does not bundle that helper or these tools.

[Reference observations](references.md) establish broad presentation cues, not asset rights or fidelity: the four tilted edge lanes and bottom hand are visible in B1 (00:05.100–00:25.003), separated groups and action controls in B1 (01:16.738–02:47.823), and an offset last tile in Y1 (00:02.010–00:12.012). Lantern Table uses its own palette, interface, audio and accessible input geometry, with tile marks from the independent CC0 source above. The sample clips do not establish this Changsha rules profile, end-to-end rendering parity, or audio equivalence.

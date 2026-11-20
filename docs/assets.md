# Lantern Table asset provenance

| What ships | Authorship and location |
|---|---|
| Lantern name, emblem, favicon, controls | Original for this project: [`web/src/lantern.svg`](../web/src/lantern.svg), [`web/src/dom.ts`](../web/src/dom.ts), and [`web/src/main.ts`](../web/src/main.ts). |
| Suited tile marks | [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles/tree/26e127ba2117f45cdce5ea0225748cc0cfad3169/Regular) at `26e127ba2117f45cdce5ea0225748cc0cfad3169`, only `Regular/Man1.svg`–`Man9.svg`, `Regular/Sou1.svg`–`Sou9.svg`, and `Regular/Pin1.svg`–`Pin9.svg`. Both the pinned [README](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/README.md#license) and [LICENSE](https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/26e127ba2117f45cdce5ea0225748cc0cfad3169/LICENSE.md) declare the assets public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). |
| Tile bodies, backs, table, wall, lighting and type | Original for this project: CSS surfaces in [`web/src/styles.css`](../web/src/styles.css) and layout in [`web/src/table.ts`](../web/src/table.ts). The browser uses its installed system and serif fonts; no font files are bundled. |
| Effects and quiet table music | Original, procedurally synthesized Web Audio tones and chords in [`web/src/audio.ts`](../web/src/audio.ts). No samples, recordings or third-party music. Audio follows the guest’s saved preferences and stays silent when the browser denies activation. |

The original project assets and code are under [GPL-3.0](../LICENSE); the adapted tile marks are CC0. We kept each suit’s painted geometry, including the calligraphed 萬, the bamboo bird and the coin rosettes. We dropped editor metadata and unused definitions, rounded vector coordinates at tile scale, adjusted the inks for ivory tile bodies, and shared repeated paths as internal fragments. There are no honor, bonus or red-five tiles, upstream code, external SVG references, scripts or fonts.

[`web/src/tile-suits.svg`](../web/src/tile-suits.svg) contains all 27 suited faces. [`web/src/tile.ts`](../web/src/tile.ts) references each symbol from the same app origin. Vite emits one fingerprinted sheet, requested only once the table renders a marked face. The landing illustration uses original CSS tile backs and the inline lantern emblem, so it does not request the sheet. The app can serve its artwork without internet access; there are no reference clips, remote asset services or bundled 3D models. The [renderer fixtures](../web/e2e/fixtures/) and Playwright captures are not included in the published app.

Measured for the desktop and tile-art pass with Vite’s production build and Node 26 `gzipSync` summed per file (an estimate, not a server compression claim):

| Cold static assets | Raw bytes | Gzip bytes |
|---|---:|---:|
| Landing: HTML, CSS, JS and favicon (32 KiB budget) | 81,903 | 26,910 |
| Additional table-only faces | 84,694 | 11,795 |
| Full table including landing assets | 166,597 | 38,705 |

Pinned development tools retain their own licenses: Vite 7.3.8 (MIT), TypeScript 5.9.3 (Apache-2.0) and Playwright 1.65.1 (Apache-2.0). The [`vite.config.ts`](../web/vite.config.ts) build disables Vite's legacy module-preload polyfill; the shipped application is a single modern ES module and does not bundle that helper or these tools.

[Reference observations](references.md) establish broad presentation cues, not asset rights or fidelity: the four tilted edge lanes and bottom hand are visible in B1 (00:05.100–00:25.003), separated groups and action controls in B1 (01:16.738–02:47.823), and an offset last tile in Y1 (00:02.010–00:12.012). Lantern Table uses its own palette, interface, audio and accessible input geometry, with tile marks from the independent CC0 source above. The sample clips do not establish this Changsha rules profile, end-to-end rendering parity, or audio equivalence.

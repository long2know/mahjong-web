# Lantern Table asset provenance

| What ships | Authorship and location |
|---|---|
| Lantern name, emblem, favicon, controls | Original for this project: [`web/src/lantern.svg`](../web/src/lantern.svg), [`web/src/dom.ts`](../web/src/dom.ts), and [`web/src/main.ts`](../web/src/main.ts). |
| Tile faces, backs, table, wall, lighting and type | Original SVG paths and procedural suit motifs in [`web/src/tile.ts`](../web/src/tile.ts), CSS surfaces in [`web/src/styles.css`](../web/src/styles.css), and layout in [`web/src/table.ts`](../web/src/table.ts). Uses conventional suit meanings and numerals, not extracted art. The browser uses its installed system and serif fonts; no font files are bundled. |
| Effects and quiet table music | Original, procedurally synthesized Web Audio tones and chords in [`web/src/audio.ts`](../web/src/audio.ts). No samples, recordings or third-party music. Audio follows the guest’s saved preferences and stays silent when the browser denies activation. |

These are project source under [GPL-3.0](../LICENSE). No external media, sprites, 3D models, copied UI files, reference footage, or runtime asset services ship. Vite’s static output contains only HTML, CSS, JS and the favicon. The test-only [renderer fixture](../web/e2e/fixtures/) and Playwright captures are not built or served by the published app.

Pinned development tools retain their own licenses: Vite 7.3.8 (MIT), TypeScript 5.9.3 (Apache-2.0) and Playwright 1.65.1 (Apache-2.0). The [`vite.config.ts`](../web/vite.config.ts) build disables Vite's legacy module-preload polyfill; the shipped application is a single modern ES module and does not bundle that helper or these tools.

[Reference observations](references.md) establish broad presentation cues, not asset rights or fidelity: the four tilted edge lanes and bottom hand are visible in B1 (00:05.100–00:25.003), separated groups and action controls in B1 (01:16.738–02:47.823), and an offset last tile in Y1 (00:02.010–00:12.012). Lantern Table uses its own palette, graphics, interface, audio and accessible input geometry. The sample clips do not establish this Changsha rules profile, end-to-end rendering parity, or audio equivalence.

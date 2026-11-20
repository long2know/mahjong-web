import { el, svg } from "./dom";
import type { Face } from "./protocol";

const suits = { b: "bamboo", c: "characters", d: "dots" } as const;
const suitedArtwork = new URL("./tile-suits.svg", import.meta.url).href;

function artwork(face: Face): SVGSVGElement {
  const node = svg("svg", { viewBox: "0 0 300 400", "aria-hidden": "true", class: "tile-art" });
  node.append(svg("use", { href: `${suitedArtwork}#lt-${face}`, width: 300, height: 400 }));
  return node;
}

export function faceName(face: Face | null): string {
  return face ? `${face[1]} ${suits[face[0] as keyof typeof suits] ?? "tile"}` : "Concealed tile";
}

export function tileFace(face: Face | null): HTMLSpanElement {
  const visual = el("span", `tile-face${face === null ? " tile-back" : ""}`);
  visual.setAttribute("aria-hidden", "true");
  if (face !== null) visual.append(artwork(face));
  return visual;
}

export function tileLabel(face: Face | null, className = ""): HTMLSpanElement {
  const node = el("span", `tile-target ${className}`, tileFace(face));
  node.setAttribute("role", "img");
  node.setAttribute("aria-label", faceName(face));
  return node;
}

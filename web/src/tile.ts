import { el, svg } from "./dom";
import type { Face } from "./protocol";

const suits = { b: "bamboo", c: "characters", d: "dots" } as const;
const layouts: readonly (readonly [number, number][])[] = [
  [[18, 22]],
  [[18, 13], [18, 31]],
  [[10, 10], [18, 22], [26, 34]],
  [[11, 12], [25, 12], [11, 32], [25, 32]],
  [[10, 10], [26, 10], [18, 22], [10, 34], [26, 34]],
  [[11, 10], [25, 10], [11, 22], [25, 22], [11, 34], [25, 34]],
  [[10, 9], [18, 13], [26, 17], [11, 26], [25, 26], [11, 36], [25, 36]],
  [[11, 8], [25, 8], [11, 17], [25, 17], [11, 27], [25, 27], [11, 36], [25, 36]],
  [[9, 10], [18, 10], [27, 10], [9, 22], [18, 22], [27, 22], [9, 34], [18, 34], [27, 34]],
];

const numerals = [
  "M10 15h16", "M12 11h12M9 18h18", "M12 8h12M13 14h10M9 20h18",
  "M9 8h18v13H9zM15 8v7l-3 3m9-10v7h4",
  "M11 8h14M15 8l-2 10m-3-5h13l-2 7M9 21h18",
  "M17 7l2 3M10 12h16m-11 4-5 5m11-5 5 5",
  "M10 14l17-4M16 7v12q0 3 3 3h6l2-4",
  "M15 8q-1 7-6 13M21 8q1 7 6 13",
  "M10 11h13l-3 8q0 3 3 3h3l1-4M17 7q-2 11-8 15",
];

function artwork(face: Face): SVGSVGElement {
  const node = svg("svg", { viewBox: "0 0 36 44", "aria-hidden": "true", class: "tile-art" });
  const suit = face[0];
  const rank = Number(face[1]);
  const layout = layouts[rank - 1];
  if (!layout) return node;
  if (suit === "c") {
    node.append(svg("path", {
      d: numerals[rank - 1], stroke: "#253b37", "stroke-width": 2.3,
      fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round",
    }), svg("path", {
      d: "M10 27h16m-9 0-1 5h8l-2 7-4-1m-2-6q-1 4-5 7", stroke: "#9c3d35",
      "stroke-width": 2, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  } else if (suit === "b" && rank === 1) {
    node.append(
      svg("path", { d: "M10 31c2-9 11-10 12-17l-2-4 4 2 4-2-1 5-4 2c1 9-3 15-12 16l-6 3z", fill: "#27574c" }),
      svg("path", { d: "M11 29c2-6 5-4 8-8 1 6-2 8-8 8Z", fill: "#f7e5a5" }),
      svg("circle", { cx: 24, cy: 13, r: 1, fill: "#fff2be" }),
      svg("path", { d: "m14 33 2 4m3-5 3 4m-12 2h13", stroke: "#a34438", "stroke-width": 1.5, fill: "none" }),
    );
  } else if (suit === "b") {
    layout.forEach(([x, y], i) => {
      const color = rank === 5 && i === 2 ? "#a34438" : i % 2 === 0 ? "#276151" : "#31695b";
      const half = rank < 6 ? 4 : 3.1;
      node.append(svg("path", {
        d: `M${x} ${y - half}v${2 * half}m-2-1.5h4`, stroke: color,
        "stroke-width": rank < 6 ? 2.9 : 2.2, "stroke-linecap": "round", fill: "none",
      }));
    });
  } else {
    layout.forEach(([x, y], i) => {
      const r = rank === 1 ? 10 : rank < 6 ? 4.7 : 3.45;
      const color = (rank === 5 && i === 2) || (rank > 5 && i < 3) ? "#9e403b" : i % 2 === 0 ? "#23596b" : "#2b6151";
      node.append(
        svg("circle", { cx: x, cy: y, r, stroke: color, "stroke-width": rank === 1 ? 2.5 : 1.5, fill: "none" }),
        svg("circle", { cx: x, cy: y, r: rank === 1 ? 3.7 : 1.15, fill: color }),
      );
      if (rank === 1) node.append(svg("path", {
        d: "M18 14v4m0 8v4m-8-8h4m8 0h4", stroke: color, "stroke-width": 1.3, "stroke-linecap": "round",
      }));
    });
  }
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

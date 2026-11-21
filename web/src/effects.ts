import "./effects.css";
import { el, svg } from "./dom";
import type { Face, Meld } from "./protocol";
import { tileFace } from "./tile";

type Point = { x: number; y: number };
type Flight = "deal" | "draw" | "discard";
type Stamp = Meld["kind"] | "reveal" | "win";

const ink: Record<Stamp, { label: string; path: string }> = {
  chi: { label: "Chow", path: "M5 19h15v23H5z M33 7q-2 10-10 18 M30 15h25 M28 26h23L36 39q-9 10 5 10h10q5 0 7-8" },
  peng: { label: "Peng", path: "M5 12h21 M17 12Q14 24 5 32 M11 28h13v17H11z M35 7l4 7 M51 7l-4 7 M30 17h27 M39 18v28 M47 18v28 M31 25l4 9 M55 25l-4 9 M30 46h28" },
  gang: { label: "Kong", path: "M5 18h25 M17 7v42 M16 22Q12 34 4 41 M19 24l12 11 M33 14h23 M45 14v31 M31 45h28" },
  bu: { label: "Supplement", path: "M12 7l8 5 M5 18h21Q20 30 5 38 M15 31v18 M23 29l6 6 M29 24l-5 5 M39 8v41 M42 20l15 10" },
  reveal: { label: "Reveal", path: "M29 5l4 5 M7 14h48 M16 20h31v8H16z M8 39v-6h46v6 M23 38q-1 9-16 13 M39 38v8q0 4 5 4h9l3-6" },
  win: { label: "Hu · Win", path: "M5 16h26 M18 7v22 M8 30h19v16H8z M36 9h19v35q0 5-7 4 M38 21h15 M37 32h16 M36 10v19q0 13-6 21" },
};

const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

export function center(node: Element): Point {
  const { x, y, width, height } = node.getBoundingClientRect();
  return { x: x + width / 2, y: y + height / 2 };
}

export function seatSpot(stage: DOMRect, seat: Element): Point {
  const mid = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const spot = mix(center(seat), mid, .22);
  const padX = Math.min(65, stage.width * .23), padY = Math.min(60, stage.height * .34);
  return {
    x: clamp(spot.x, stage.left + padX, stage.right - padX),
    y: clamp(spot.y, stage.top + padY, stage.bottom - padY),
  };
}

export class TableEffects {
  readonly root = el("div", "table-effects");
  private readonly active = new Set<Animation>();

  constructor() {
    this.root.setAttribute("aria-hidden", "true");
    const clear = () => this.clear();
    window.addEventListener("resize", clear);
    window.visualViewport?.addEventListener("resize", clear);
  }

  clear(): void {
    this.active.forEach(animation => animation.cancel());
    this.active.clear();
    this.root.replaceChildren();
  }

  private play(
    node: Element, frames: Keyframe[], duration: number, delay = 0, remove = true,
  ): void {
    const animation = node.animate(frames, { duration, delay, fill: remove ? "both" : "backwards" });
    this.active.add(animation);
    const clean = () => {
      this.active.delete(animation);
      if (remove) node.remove();
    };
    void animation.finished.then(clean, clean);
  }

  private anchor(node: HTMLElement, point: Point, layer: DOMRect): void {
    node.style.left = `${point.x - layer.x}px`;
    node.style.top = `${point.y - layer.y}px`;
    this.root.append(node);
  }

  flight(
    layer: DOMRect, kind: Flight, from: Point, to: Point, face: Face | null, delay = 0, landing?: Element,
  ): void {
    const node = el("span", `effect-flight effect-flight--${kind}`, tileFace(face));
    node.style.setProperty("--trail-turn", `${Math.atan2(to.y - from.y, to.x - from.x)}rad`);
    this.anchor(node, from, layer);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const hop = clamp(distance * .26, 17, 44);
    const curl = (kind === "discard" ? 1 : -1) * clamp(distance * .13, 9, 24);
    const at = (t: number, lift: number, turn: number, scale: number) =>
      `translate(${(to.x - from.x) * t + curl * lift}px,${(to.y - from.y) * t - hop * lift}px) translate(-50%,-50%) rotate(${turn}deg) scale(${scale})`;
    const duration = kind === "deal" ? 410 : kind === "draw" ? 390 : 340;
    this.play(node, [
      { transform: at(0, 0, -17, .7), opacity: 0, easing: "ease-out" },
      { transform: at(.13, .52, -24, .93), opacity: 1, offset: .14 },
      { transform: at(.52, 1, 11, 1.17), opacity: 1, offset: .48, easing: "ease-in" },
      { transform: at(.99, .03, -5, .76), opacity: 1, offset: .82 },
      { transform: at(1, 0, 0, .54), opacity: 0 },
    ], duration, delay);
    this.impact(layer, to, kind, duration * .7 + delay);
    if (landing) {
      // Glint on the actual destination; the clone alone moves across the table.
      this.play(landing, [
        { filter: "brightness(1)" }, { filter: "brightness(1.45)", offset: .7 }, { filter: "brightness(1)" },
      ], duration, delay, false);
    }
  }

  private impact(layer: DOMRect, point: Point, kind: Flight, delay: number): void {
    const ring = el("i", `effect-impact effect-flight--${kind}`);
    this.anchor(ring, point, layer);
    this.play(ring, [
      { transform: "translate(-50%,-50%) scale(.48)", opacity: 0 },
      { transform: "translate(-50%,-50%) scale(.73)", opacity: .95, offset: .16, easing: "ease-out" },
      { transform: "translate(-50%,-50%) scale(1.62)", opacity: 0 },
    ], 170, delay);
  }

  stamp(layer: DOMRect, point: Point, kind: Stamp, caption = ink[kind].label): void {
    const { path } = ink[kind];
    const glyph = svg("svg", { viewBox: "0 0 64 56", class: "effect-glyph" });
    glyph.append(svg("path", { d: path, class: "effect-ink-outline" }), svg("path", { d: path }));
    const seal = el("span", "effect-seal", glyph, el("span", "effect-caption", caption));
    const first = el("i", "effect-ring");
    const second = el("i", "effect-ring effect-ring--outer");
    const stamp = el("div", `effect-stamp effect-stamp--${kind}`, first, second, seal);
    this.anchor(stamp, point, layer);
    const duration = kind === "win" ? 520 : 540;
    const headroom = Math.max(0, 72 - (point.y - layer.y));
    this.play(stamp, [{ opacity: 1 }, { opacity: 1, offset: .77 }, { opacity: 0 }], duration);
    this.play(seal, [
      { transform: "translateY(25px) rotate(-17deg) scale(.38,.57)", opacity: .6, easing: "ease-out" },
      { transform: `translateY(${headroom - 10}px) rotate(7deg) scale(1.19,1.24)`, opacity: 1, offset: .19 },
      { transform: "translateY(2px) rotate(-7deg) scale(.94,.91)", offset: .35 },
      { transform: "translateY(-2px) rotate(-9deg) scale(1.05,1.02)", offset: .51 },
      { transform: "translateY(-10px) rotate(-6deg) scale(.98)" },
    ], duration, 0, false);
    for (const [i, ring] of [first, second].entries()) {
      this.play(ring, [
        { transform: "scale(.38)", opacity: 0, easing: "ease-out" },
        { transform: "scale(.82)", opacity: .98, offset: .17, easing: "ease-out" },
        { transform: "scale(1.66)", opacity: 0 },
      ], duration - 75, i * 75, false);
    }
    const rays = kind === "win" ? 10 : 7;
    for (let i = 0; i < rays; i++) {
      const spark = el("i", "effect-spark");
      stamp.append(spark);
      const theta = i * 2 * Math.PI / rays + .17;
      const travel = (r: number, s: number) =>
        `translate(${r * Math.cos(theta)}px,${r * Math.sin(theta) * .72}px) rotate(${theta + Math.PI / 4}rad) scale(${s})`;
      this.play(spark, [
        { transform: travel(20, .4), opacity: 0, easing: "ease-out" },
        { transform: travel(49 + i % 3 * 5, 1.2), opacity: 1, offset: .3, easing: "ease-out" },
        { transform: travel(85 + i % 3 * 9, .4), opacity: 0 },
      ], 365, 25 + i % 3 * 12);
    }
  }

  score(layer: DOMRect, point: Point, points: string, gain: boolean): void {
    const node = el("b", `effect-score effect-score--${gain ? "gain" : "loss"}`, points);
    this.anchor(node, point, layer);
    const rise = gain ? -31 : 18;
    this.play(node, [
      { transform: "translate(-50%,-50%) scale(.5)", opacity: .45, easing: "ease-out" },
      { transform: `translate(-50%,calc(-50% + ${rise * .42}px)) scale(1.24)`, opacity: 1, offset: .22 },
      { transform: `translate(-50%,calc(-50% + ${rise * .75}px)) scale(1)`, opacity: 1, offset: .76 },
      { transform: `translate(-50%,calc(-50% + ${rise}px)) scale(.92)`, opacity: 0 },
    ], 520);
  }
}

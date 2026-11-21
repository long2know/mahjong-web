import "./finale.css";
import { el } from "./dom";
import type { places } from "./dom";

type Place = typeof places[number];
type Point = { x: number; y: number };
const duration = 520;
const sockets: Record<Place, readonly [number, number]> = {
  near: [-.32, .27], left: [-.40, -.07], far: [.29, -.25], right: [.35, .12],
};

const lantern = `
<svg class="finale-lantern" viewBox="0 0 220 140" aria-hidden="true">
  <defs>
    <linearGradient id="finale-brass" x2=".8" y2="1">
      <stop stop-color="#fff5be"/><stop offset=".43" stop-color="#dc9b4e"/><stop offset=".61" stop-color="#8f4c27"/>
      <stop offset="1" stop-color="#ffd582"/>
    </linearGradient>
    <linearGradient id="finale-silk" x2=".14" y2="1">
      <stop stop-color="#8b382b"/><stop offset=".35" stop-color="#ee8745"/><stop offset=".58" stop-color="#ffc16b"/>
      <stop offset="1" stop-color="#9b3928"/>
    </linearGradient>
    <radialGradient id="finale-light">
      <stop stop-color="#ffdf9a" stop-opacity=".66"/><stop offset=".55" stop-color="#ffb365" stop-opacity=".24"/>
      <stop offset="1" stop-color="#f4934c" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="110" cy="69" rx="105" ry="68" fill="url(#finale-light)"/>
  <g fill="none" stroke="url(#finale-brass)" stroke-linecap="round">
    <path d="M20 111c12-12 59-18 90-18s78 6 90 18c-12 12-59 18-90 18s-78-6-90-18Z" opacity=".35"/>
    <path d="M41 113c17-7 39-12 69-12s52 5 69 12c-17 8-39 11-69 11s-52-3-69-11Z" opacity=".61"/>
    <path d="M64 92 52 79H39l-9-9 9-9h13l12-13m92 44 12-13h13l9-9-9-9h-13l-12-13M46 70h11m106 0h11" opacity=".73"/>
    <path d="M110 8c34 0 61 24 61 56s-27 56-61 56-61-24-61-56S76 8 110 8Z" opacity=".42"/>
    <path d="M110 13 145 26l19 37-19 37-35 15-35-15-19-37 19-37Z" stroke-width="1.5" opacity=".92"/>
    <path d="m110 20 31 11 15 32-15 32-31 13-31-13-15-32 15-32Z" opacity=".49"/>
    <path d="m110 4 5 7-5 7-5-7Zm0 105 5 7-5 7-5-7Z M55 58l4 5-4 5-4-5Zm110 0 4 5-4 5-4-5Z" fill="#503021"/>
  </g>
  <path d="M110 18v19m-4-13c0-6 8-6 8 0s-8 6-8 0Z" fill="none" stroke="#ffe0a2" stroke-width="1.75"/>
  <g stroke="#432820" stroke-width="2" stroke-linejoin="round">
    <path d="M85 40q10-2 17-11h16q7 9 17 11l-3 6H88Z" fill="url(#finale-brass)"/>
    <path d="M89 43h42q10 10 16 24-7 16-18 25H91Q79 84 73 67q6-14 16-24Z" fill="url(#finale-silk)"/>
    <path d="M102 44h16q12 11 14 23-2 14-14 24h-16Q90 81 88 67q2-12 14-23Z" fill="#ffd279" stroke="#a85533" stroke-width="1.2"/>
    <path d="M106 44h8q7 11 9 23-2 14-9 24h-8q-8-10-9-24 2-12 9-23Z" fill="#ffe5a0" stroke="#de994e" stroke-width="1.1"/>
    <path d="M86 89h48l-8 9H94Z" fill="url(#finale-brass)"/>
    <path d="m105 98 5 6 5-6" fill="#ffc874" stroke-width="1.4"/>
  </g>
  <path d="M90 42h40m-41 47h42m-35 6h28M77 67l7-4m52 0 7 4" fill="none" stroke="#ffe2a1" stroke-width="1.45" stroke-linecap="round"/>
  <path d="M110 49c2 11 13 14 10 24-1 5-5 8-10 8s-10-3-10-9c0-9 8-13 10-23Z" fill="#ec8c36"/>
  <path d="M110 62c1 6 6 8 6 12 0 7-12 7-12 0 0-5 5-8 6-12Z" fill="#fff5c3"/>
  <path d="M110 102v14m-5 0 5-4 5 4-5 8Zm3 8-2 10m6-10 2 10" fill="#df9656" stroke="#e6ab60" stroke-linecap="round"/>
</svg>`;

const votive = `
<svg viewBox="0 0 20 29" aria-hidden="true">
  <path d="M10 1v4m-2 16h4m-2 0v5m-2 1 2-2 2 2M6 4h8l2 3 2 6-4 7H6l-4-7 2-6Z"
    fill="#985028" stroke="#ffdb8d" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 6h4l2 7-2 5H8l-2-5Z" fill="#ffb35a"/>
  <path d="M10 8q5 7 0 8-5-1 0-8Z" fill="#fff1b7"/>
</svg>`;

function anchor(node: HTMLElement, { x, y }: Point): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

export class HallFinale {
  private layer?: HTMLElement;
  private animations: Animation[] = [];

  constructor(private readonly cast: HTMLElement, private readonly center?: HTMLElement) {}

  clear(): void {
    this.animations.forEach(animation => animation.cancel());
    this.animations = [];
    this.layer?.remove();
    this.layer = undefined;
  }

  play(winners: SVGSVGElement[]): void {
    this.clear();
    if (!winners.length || !this.cast.isConnected || !this.cast.animate) return;
    const table = this.cast.getBoundingClientRect();
    const center = this.center?.getBoundingClientRect();
    if (!center || !table.width || !table.height) return;

    // The solid lantern sits just beside the wall count; the openwork spans the middle.
    const size = Math.min(250, table.height * .72, table.width * .34);
    const low = table.height < 210 && table.width > 400 ? size * .10 : 0;
    const hearth = { x: center.right - table.left + size * .2 + 5, y: center.y + center.height / 2 - table.top + low };
    const origins = winners.map(actor => {
      const box = actor.getBoundingClientRect();
      const x = box.x + box.width / 2 - table.left, y = box.y + box.height * .6 - table.top;
      const inward = Math.atan2(hearth.y - y, hearth.x - x);
      return {
        seat: actor.dataset.actorSeat!,
        socket: sockets[actor.dataset.place as Place],
        point: { x: x + Math.cos(inward) * box.width * .34, y: y + Math.sin(inward) * box.height * .27 },
      };
    });

    const layer = this.layer = el("div", "hall-finale");
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--finale-size", `${size}px`);
    const crest = el("div", "finale-crest");
    crest.innerHTML = lantern;
    anchor(crest, hearth);
    layer.append(crest);
    this.cast.prepend(layer);

    const play = (node: Element, frames: Keyframe[]) => {
      const animation = node.animate(frames, { duration, fill: "both" });
      this.animations.push(animation);
      return animation;
    };
    // One finite timeline; the first effect owns cleanup for all descendants and relays.
    const lead = play(layer, [
      { opacity: 1 }, { opacity: 1, offset: .89, easing: "ease-in" }, { opacity: 0 },
    ]);
    void lead.finished.then(() => { if (this.layer === layer) this.clear(); }, () => {});

    play(crest, [
      { opacity: 0, transform: "translate(-50%, -50%) scale(.70)", offset: .10, easing: "ease-out" },
      { opacity: .46, transform: "translate(-50%, -50%) scale(.92)", offset: .34 },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1.055)", offset: .56, easing: "ease-out" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
    ]);

    for (const { seat, socket, point } of origins) {
      const endX = hearth.x + socket[0] * size - point.x;
      const endY = hearth.y + socket[1] * size - point.y;
      const bow = Math.min(38, Math.max(Math.min(26, size * .24), Math.hypot(endX, endY) * .17));
      const relay = el("span", "finale-relay");
      relay.dataset.finaleSeat = seat;
      relay.innerHTML = votive;
      const wake = el("i", "finale-wake");
      wake.style.setProperty("--bearing", `${Math.atan2(endY, endX)}rad`);
      relay.prepend(wake);
      anchor(relay, point);
      layer.append(relay);
      const pose = (t: number, lift: number, angle: number, scale: number) => ({
        transform: `translate(${endX * t}px, ${endY * t - bow * lift}px) translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`,
      });
      play(relay, [
        { ...pose(0, 0, -8, .66), opacity: 0, easing: "ease-out" },
        { ...pose(.04, .20, -8, .94), opacity: .96, offset: .14 },
        { ...pose(.50, 1, 6, 1.05), opacity: 1, offset: .31, easing: "ease-out" },
        { ...pose(1, 0, 0, .79), opacity: 1, offset: .55 },
        { ...pose(1, 0, 0, .79), opacity: 1 },
      ]);
      play(wake, [
        { opacity: 0 }, { opacity: .85, offset: .24 }, { opacity: .50, offset: .35 }, { opacity: 0, offset: .54 },
      ]);
    }

    for (let i = 0; i < 8; i++) {
      const ember = el("i", "finale-ember");
      const angle = (i + .5) * Math.PI / 4;
      const x = Math.cos(angle) * size * .48, y = Math.sin(angle) * size * .31;
      const spark = (r: number, scale: number) => `translate(${x * r}px, ${y * r}px) rotate(45deg) scale(${scale})`;
      const beat = i % 2 * .04;
      anchor(ember, hearth);
      layer.append(ember);
      play(ember, [
        { transform: spark(.33, .3), opacity: 0, offset: .39 + beat, easing: "ease-out" },
        { transform: spark(.75, 1), opacity: 1, offset: .56 + beat, easing: "ease-out" },
        { transform: spark(1, .32), opacity: 0, offset: .9 + beat },
      ]);
    }
  }
}

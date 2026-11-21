import "./actors.css";
import "./hall.css";
import { HallDial } from "./dial";
import { places } from "./dom";
import { HallFinale } from "./finale";
import type { Seat, Snapshot } from "./protocol";

type Mood = "rest" | "ready" | "win" | "loss";
type Gesture = "discard" | "call" | "win" | "loss" | "gather";
export type ActorMoment = { seat: Seat; gesture: Gesture; target?: Element };

const cast = [
  {
    name: "Maple", fur: "#ef9663", shade: "#a74845", light: "#ffdeb1", ink: "#422932",
    coat: "#a43f53", trim: "#efb37f", eye: "#764034", eyeY: 47, eyeW: 6.7,
    silhouette: '<path d="M37 89C24 96 10 92 8 80c-3 14 2 24 20 24l16-3Z"/><path fill="var(--light)" d="M8 80q-6 16 8 21l5-8Q10 90 8 80Z"/>',
    ears: '<path d="M23 45 18 13q1-5 5-2l28 22m22 0 22-24q4-3 5 3l-5 35"/><path fill="var(--shade)" stroke="none" d="m25 36-2-19 18 15zm56-4 14-16-3 23z"/>',
    head: "M20 46c1-15 17-24 38-25 23-1 35 9 40 24l4 4-5 3 2 4-7 1c-6 11-24 17-39 16-14-1-26-6-31-15l-6-2 4-5-4-3Z",
    mask: '<path d="M21 47c11 1 18 3 24 8q9 5 17 0c13-6 23-7 35-6-4 15-19 23-38 23-19 0-33-10-38-25Z"/><path fill="var(--ink)" d="M59 55q6-3 11 0-2 5-6 5-3 0-5-5Z"/>',
    vest: '<path d="M42 70q12 8 25 4l9-4-13 18-21-9Z"/><path d="m64 82 7 11 6-4-9-9Z"/>',
  },
  {
    name: "Pip", fur: "#cdb9e4", shade: "#8575a8", light: "#f7e6f4", ink: "#382f50",
    coat: "#496596", trim: "#ffbc8f", eye: "#594980", eyeY: 48, eyeW: 6,
    silhouette: '<path d="M34 89q-6-10-14-7-10 5-2 15 6 6 18 1Z" fill="var(--light)"/>',
    ears: '<path d="M36 35C25 21 24 3 29 3q10 0 19 29m14-4C63 12 70 0 77 4q6 4-3 30"/><path fill="var(--shade)" stroke="none" d="M37 28Q29 15 32 9q6 3 11 20Zm31-2q3-15 8-16 0 7-5 18Z"/>',
    head: "M24 49c-2-15 10-25 29-27 21-2 38 7 41 22 4 14-6 27-25 29-21 4-43-5-45-24Z",
    mask: '<path d="M38 61q12-11 24-5 13-7 24 1-3 14-24 15-18-1-24-11Z"/><ellipse cx="64" cy="55" rx="3.5" ry="2.2" fill="var(--shade)"/><path d="M32 40q2-9 12-10" fill="none" stroke="var(--light)" stroke-width="2"/>',
    vest: '<path d="M42 71q15 9 30 1l5 8-10 4 1 14h-8l-1-15q-11 0-19-5Z"/><path d="m62 91 5 0" fill="none" stroke="var(--ink)"/>',
  },
  {
    name: "Tallow", fur: "#dcb881", shade: "#96734e", light: "#fff1c8", ink: "#47362e",
    coat: "#47765b", trim: "#d8d27d", eye: "#79502a", eyeY: 46, eyeW: 7.5,
    silhouette: '<path d="M39 79Q20 78 21 93l-2 6q15 1 24-11Z" fill="var(--shade)"/>',
    ears: '<path d="M23 40 21 16q9 1 20 10m35-1q10-8 22-7l-6 25"/><path fill="var(--light)" stroke="none" d="m24 22 10 5-8 8zm63 6 8-5-3 12z"/>',
    head: "M21 41q5-17 28-19l7-6 4 5 8-4 2 6c15 2 26 11 28 24 3 14-12 26-32 26-29 1-49-12-45-32Z",
    mask: '<path d="M34 36q11-10 26 2 12-12 25-2c15 11 4 32-17 32-24 4-48-15-34-32Z"/><path d="m57 54 7-4 7 4-6 6Z" fill="#db8351" stroke="var(--ink)" stroke-width="1"/><path d="M38 32l5-2m33 0 5 2" fill="none" stroke="var(--shade)" stroke-width="1.5"/>',
    vest: '<path d="m40 72 13 3 10 14 11-15 8-2-9 17-10 8-15-13Z"/><path d="m63 89 4 4-4 4-4-4Z" fill="#fff1c8"/>',
  },
  {
    name: "Nori", fur: "#81c8b7", shade: "#448789", light: "#d9edb7", ink: "#293e52",
    coat: "#695582", trim: "#f4ad8e", eye: "#356477", eyeY: 47, eyeW: 7,
    silhouette: '<path d="M38 91c-10 6-22 8-23 0l4-6q-15 2-12 11 2 10 30 4Z"/><path fill="var(--light)" d="M10 98q-7-6-1-11 2-3 10-2l-4 6q0 4 5 6Z"/>',
    ears: '<path d="M33 40C17 32 11 25 14 22q3-2 15 7-8-10-5-13 3-1 14 12m39-1 12-15 2 10 11-1-6 8 10 4q-5 6-16 7" fill="var(--trim)"/><path fill="var(--light)" d="M47 25q-5-12 2-16l7 14m6 0q1-14 8-13l1 15"/>',
    head: "M24 43c2-13 16-22 33-22 21 0 31 7 37 19l7 6-5 5q0 18-24 21C50 76 24 64 24 43Z",
    mask: '<path d="M32 54q15-1 22 5 16-8 40-7-3 18-27 19-25-1-35-17Z"/><path d="M60 54h.1m9-1h.1" fill="none" stroke="var(--shade)" stroke-width="2.8" stroke-linecap="round"/><path d="m52 29 5 3 6-4" fill="none" stroke="var(--light)" stroke-width="2"/>',
    vest: '<path d="M43 72q13 4 23 4l11-3-7 9-9 2-5 12-7-3 6-11-14-4Z"/><path d="M72 87q4 4 7 0m-8 6q4 4 7 0" fill="none" stroke="var(--trim)"/>',
  },
] as const;

const paw = `
  <path data-hand="rest" d="M-1-4Q5-7 10-4q5 3 3 7-3 6-10 4l-4-2Z"/>
  <path data-hand="open" d="M-2-4 3-7 6-6 7-4l8-5q3-1 3 2l-6 5 7-3q4 0 2 3l-8 4 7-1q3 1 1 3L10 8q-8 0-12-3Z"/>
  <path data-hand="point" d="M-2-4q5-4 9-1l12-3q4 1 2 4L11-1q6 1 4 6-2 4-10 3L-2 5Z"/>
  <path data-hand="fist" d="M-2-5q2-4 7-3 3-3 6 0 6-1 7 4 3 1 0 7-2 6-12 6l-8-4Z"/>
  <path d="M2-3 4-1" fill="none" stroke="var(--light)" stroke-width="1.6"/>
`;

function arm(x: number, main = false): string {
  const [shoulder, elbow, wrist] = main ? ["shoulder", "elbow", "wrist"] : ["rear-shoulder", "rear-elbow", "rear-wrist"];
  return `<g transform="translate(${x} 71)">
    <g data-joint="${shoulder}" fill="var(--coat)">
      <path d="M0-6q9-4 23-1 6 4 1 12-12 7-23 3C-6 5-6-2 0-6Z"/>
      <path d="M2-5q8-2 16-1" stroke="var(--trim)" stroke-opacity=".6" stroke-width="1.5" fill="none"/>
      <g transform="translate(22 0)">
        <g data-joint="${elbow}">
          <path d="M-4-6q11-3 21 1l2 11Q9 11-4 7q-6-4 0-13Z"/>
          <path d="M12-6q2 6 1 14l5-2q1-6-1-11Z" fill="var(--trim)" stroke-width="1.25"/>
          <g transform="translate(17 0)">
            <g data-joint="${wrist}" ${main ? "data-main-paw" : ""} fill="var(--fur)" stroke-width="1.65">${paw}</g>
          </g>
        </g>
      </g>
    </g>
  </g>`;
}

function build(seat: Seat): SVGSVGElement {
  const { name, fur, shade, light, ink, coat, trim, eye, eyeY, eyeW, silhouette, ears, head, mask, vest } = cast[seat];
  const furId = `actor-fur-${seat}`;
  const coatId = `actor-coat-${seat}`;
  const template = document.createElement("template");
  template.innerHTML = `<svg class="seat-actor" viewBox="0 0 120 116" data-character="${name}" data-actor-seat="${seat}"
    style="--fur:${fur};--shade:${shade};--light:${light};--ink:${ink};--coat:${coat};--trim:${trim}">
    <defs>
      <linearGradient id="${furId}" x2=".28" y2="1">
        <stop stop-color="${light}"/><stop offset=".36" stop-color="${fur}"/><stop offset="1" stop-color="${shade}"/>
      </linearGradient>
      <linearGradient id="${coatId}" x2=".2" y2="1">
        <stop stop-color="${coat}"/><stop offset=".55" stop-color="${coat}"/><stop offset="1" stop-color="${ink}"/>
      </linearGradient>
    </defs>
    <g data-facing>
      <ellipse cx="59" cy="106" rx="40" ry="8" fill="#10231e" opacity=".3"/>
      <ellipse cx="57" cy="106" rx="32" ry="5" fill="#10231e" opacity=".59"/>
      <g stroke="var(--ink)" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round">
        <path d="M27 103q0-9 12-8l37 0q13 0 14 8-10 5-32 5-22 0-31-5Z" fill="${coat}"/>
        <path d="M34 104q8-2 16-1m16 0 14 0" fill="none" stroke="${trim}" stroke-width="1.3"/>
        <g fill="${fur}">${silhouette}</g>
        <g transform="translate(58 98)">
          <g data-joint="body">
            <g transform="translate(-58 -98)">
              ${arm(37)}
              <path d="M34 80c2-11 11-16 24-16s23 5 25 17l3 15q-8 9-28 9-19 0-29-8Z" fill="url(#${coatId})"/>
              <path d="M34 95q23 10 45 0" fill="none" stroke="${trim}" stroke-opacity=".63" stroke-width="1.5"/>
              <g fill="${trim}" stroke-width="1.5">${vest}</g>
              <g transform="translate(58 68)">
                <g data-joint="head">
                  <g transform="translate(-58 -68)">
                    <g fill="${fur}">${ears}</g>
                    <path d="${head}" fill="url(#${furId})"/>
                    <g fill="${light}" stroke="none">${mask}</g>
                    <path d="M37 53q3 2 8 2m35 0 5-2" stroke="${shade}" stroke-opacity=".65" stroke-width="2.4" fill="none"/>
                    <g data-brows fill="none" stroke-width="1.8">
                      <path d="M40 ${eyeY - 10}q5-4 11-2m23 0q5-2 10 2"/>
                    </g>
                    <g data-eyes="open" fill="#fff7de" stroke-width="1.2">
                      <ellipse cx="47" cy="${eyeY}" rx="${eyeW}" ry="7.5"/><ellipse cx="78" cy="${eyeY}" rx="${eyeW - .8}" ry="7"/>
                      <g data-pupils fill="${eye}" stroke="none">
                        <ellipse cx="47" cy="${eyeY + .5}" rx="3.7" ry="4.9"/><ellipse cx="78" cy="${eyeY + .5}" rx="3.5" ry="4.5"/>
                        <path d="M47 ${eyeY - 1}h.1m31 0h.1" stroke="#fff9de" stroke-width="2.1"/>
                      </g>
                    </g>
                    <path data-eyes="win" d="M41 49q6-10 13-1m17 0q6-10 12 0" fill="none" stroke-width="3"/>
                    <path data-eyes="loss" d="M41 48q8 3 13-3m18 0q6 6 12 2" fill="none" stroke-width="2.8"/>
                    <path data-mouth="rest" d="M59 62q5 3 10-1" fill="none" stroke-width="1.65"/>
                    <path data-mouth="focus" d="M59 63q5-3 10-1" fill="none" stroke-width="1.7"/>
                    <path data-mouth="call" d="M59 61q5-2 11-1 1 8-6 8-5-1-5-7Z" fill="#93455b" stroke-width="1.45"/>
                    <path data-mouth="win" d="M55 59q10 6 20-1-3 12-12 11-6-1-8-10Z" fill="#a14a56" stroke-width="1.55"/>
                    <path data-mouth="loss" d="M58 65q5-7 11-4" fill="none" stroke-width="2.1"/>
                  </g>
                </g>
              </g>
              ${arm(80, true)}
            </g>
          </g>
        </g>
      </g>
    </g>
  </svg>`;
  return template.content.firstElementChild as SVGSVGElement;
}

type Pose = [x: number, y: number, lean: number, nod: number, shoulder: number, elbow: number, wrist: number,
  rearShoulder: number, rearElbow: number, rearWrist: number];
type Beat = [offset: number, pose: Pose];
const rest: Pose = [0, 0, 0, 0, 102, -79, -8, 126, -85, -7];
const ready: Pose = [1, 0, 2, -3, 98, -82, -8, 128, -85, -7];
const win: Pose = [0, -2, -4, -5, 88, -77, 12, 144, -88, 10];
const loss: Pose = [-2, 2, -7, 11, 120, -61, 22, 111, -71, 13];
const tableau: Record<Mood, Pose> = { rest, ready, win, loss };
const joints = ["body", "head", "shoulder", "elbow", "wrist", "rear-shoulder", "rear-elbow", "rear-wrist"];

function transforms([x, y, lean, ...angles]: Pose): string[] {
  return [`translate(${x}px,${y}px) rotate(${lean}deg)`, ...angles.map(angle => `rotate(${angle}deg)`)];
}

const toDegrees = 180 / Math.PI;
const limit = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

function reach(node: SVGSVGElement, target: Element | undefined): Pose {
  const frame = node.getBoundingClientRect(), tile = target?.getBoundingClientRect();
  const scale = frame.width / 120 || 1;
  const place = node.dataset.place;
  const mirror = place === "right" || place === "far" ? -1 : 1;
  const lean = 11;
  // Peak shoulder position in the leaning torso. Aim the open palm just short of the public tile.
  const x = tile ? 60 + (tile.x + tile.width / 2 - frame.x - frame.width / 2) * mirror / scale : 137;
  const y = tile ? (tile.y + tile.height / 2 - frame.y) / scale : 58;
  const dx = Math.max(12, x - 91), dy = y - 78;
  const dense = node.parentElement!.clientHeight < 150;
  // Keep the side palms in the narrow gaps above and below their nameplates in the dense layout.
  const direction = limit(Math.atan2(dy, dx) * toDegrees, dense && place === "right" ? -31 : -68, dense && place === "left" ? 22 : 61);
  const distance = limit(Math.hypot(dx, dy) - (tile?.width ?? 0) / (2 * scale) - 7, 32, 53);
  const elbow = -Math.acos(limit((distance ** 2 - 22 ** 2 - 33 ** 2) / (2 * 22 * 33), -1, 1));
  const shoulder = direction - lean - Math.atan2(33 * Math.sin(elbow), 22 + 33 * Math.cos(elbow)) * toDegrees;
  return [6, 1, lean, 3, shoulder, elbow * toDegrees, 8, 146, -76, -13];
}

function beats(node: SVGSVGElement, moment: ActorMoment, still: Pose): [number, Beat[]] {
  switch (moment.gesture) {
    case "discard": {
      const peak = reach(node, moment.target);
      const [x, y, lean, nod, shoulder, elbow, wrist, rearShoulder, rearElbow, rearWrist] = peak;
      return [475, [
        [0, still], [.22, [-7, 2, -11, 6, 148, -104, -15, 123, -97, 8]],
        [.48, peak], [.62, [x + 2, y + 1, lean + 2, nod + 3, shoulder + 11, elbow + 5, wrist + 16,
          rearShoulder, rearElbow, rearWrist]],
        [.81, [3, 0, 6, -2, 68, -77, -8, 134, -85, -8]], [1, still],
      ]];
    }
    case "call":
      return [555, [[0, still], [.15, [-3, 1, -6, 7, 111, -108, 6, 133, -98, 3]],
        [.39, [3, -3, 5, -12, -32, -19, 9, 151, -117, -14]],
        [.61, [3, -3, 5, -10, -33, -10, 7, 149, -115, -11]],
        [.78, [1, -1, 2, 4, 31, -62, -5, 136, -92, 0]], [1, still]]];
    case "win":
      return [535, [[0, rest], [.16, [0, 4, 3, 9, 105, -112, -5, 108, -102, 3]],
        [.37, [0, -5, -5, -12, -44, -33, 24, 205, 59, -12]],
        [.59, [1, -3, 3, -8, -27, -53, 17, 202, 44, -8]],
        [.76, [0, -4, -4, -12, -40, -40, 22, 204, 58, -10]], [1, still]]];
    case "loss":
      return [500, [[0, rest], [.19, [-4, -3, -11, -7, 41, -52, -9, 151, -51, -5]],
        [.48, [-4, 3, -12, 18, 137, -55, 25, 100, -60, 18]],
        [.72, [-3, 4, -8, 13, 128, -58, 27, 105, -61, 15]], [1, still]]];
    case "gather":
      return [410, [[0, still], [.22, [0, 1, -4, -4, 100, -91, 4, 134, -94, 8]],
        [.53, [4, 2, 8, 8, 45, -39, -21, 86, -57, -22]],
        [.71, [2, -1, 2, 5, 83, -95, -14, 99, -86, -14]], [1, still]]];
  }
}

class SeatActor {
  readonly root: SVGSVGElement;
  private readonly facing: SVGGElement;
  private readonly parts: SVGGElement[];
  private mood: Mood | undefined;
  private active: Animation[] = [];

  constructor(seat: Seat) {
    this.root = build(seat);
    this.facing = this.root.querySelector("[data-facing]")!;
    this.parts = joints.map(joint => this.root.querySelector<SVGGElement>(`[data-joint="${joint}"]`)!);
  }

  present(place: typeof places[number], mood: Mood): void {
    if (this.root.dataset.place !== place) {
      this.root.dataset.place = place;
      this.facing.setAttribute("transform", place === "far" || place === "right" ? "translate(120 0) scale(-1 1)" : "");
    }
    if (this.mood === mood) return;
    this.mood = mood;
    this.root.dataset.mood = mood;
    transforms(tableau[mood]).forEach((transform, i) => { this.parts[i].style.transform = transform; });
  }

  clear(): void {
    this.active.forEach(animation => animation.cancel());
    this.active = [];
    delete this.root.dataset.gesture;
  }

  play(moment: ActorMoment): void {
    this.clear();
    if (!this.root.animate) return;
    const [duration, poses] = beats(this.root, moment, tableau[this.mood ?? "rest"]);
    const frames = poses.map(([offset, pose]) => ({ offset, values: transforms(pose) }));
    this.root.dataset.gesture = moment.gesture;
    this.active = this.parts.map((part, i) => part.animate(frames.map(({ offset, values }) => ({
      offset, transform: values[i], easing: i === 3 ? "cubic-bezier(.27,.1,.4,1)" : "cubic-bezier(.3,.02,.38,1)",
    })), duration));
    if (moment.gesture === "discard") {
      for (const [shape, open] of [["rest", 0], ["open", 1]] as const) {
        const hand = this.root.querySelector(`[data-main-paw] [data-hand="${shape}"]`)!;
        this.active.push(hand.animate([
          { opacity: 1 - open }, { opacity: 1 - open, offset: .33 },
          { opacity: open, offset: .45 }, { opacity: open, offset: .68 },
          { opacity: 1 - open, offset: .81 }, { opacity: 1 - open },
        ], duration));
      }
    }
    const [lead] = this.active;
    void lead.finished.then(() => {
      if (this.active[0] === lead) this.clear();
    }, () => {});
  }
}

export class SeatCast {
  private readonly actors = ([0, 1, 2, 3] as const).map(seat => new SeatActor(seat));
  private readonly finale: HallFinale;
  private readonly dial?: HallDial;
  private revealWin = false;

  constructor(root: HTMLElement, center?: HTMLElement) {
    this.finale = new HallFinale(root, center);
    if (center) this.dial = new HallDial(center);
    root.replaceChildren(...this.actors.map(actor => actor.root));
  }

  present(state: Snapshot, liveMotion = false): void {
    this.dial?.present(state, liveMotion);
    const game = state.game!;
    // A cold chunk arriving mid-settlement should not start a late finale behind the review.
    this.revealWin = liveMotion && game.settlement?.reason === "win";
    this.actors.forEach((actor, seat) => {
      const wins = game.settlement?.winners.some(winner => winner.seat === seat);
      const loses = game.settlement?.seatResults.some(score => score.seat === seat && score.delta < 0);
      const mood = wins ? "win" : loses ? "loss" :
        !state.room.paused && game.phase === "turn" && game.turnSeat === seat ? "ready" : "rest";
      actor.present(places[(seat - state.self.seat + 4) % 4], mood);
    });
  }

  play(moments: ActorMoment[]): void {
    const bySeat = new Map(moments.map(moment => [moment.seat, moment]));
    if (this.revealWin) {
      this.revealWin = false;
      this.finale.play([...bySeat.values()].filter(moment => moment.gesture === "win")
        .map(moment => this.actors[moment.seat].root));
    }
    bySeat.forEach(moment => this.actors[moment.seat].play(moment));
  }

  clear(): void {
    this.revealWin = false;
    this.dial?.clear();
    this.finale.clear();
    this.actors.forEach(actor => actor.clear());
  }
}

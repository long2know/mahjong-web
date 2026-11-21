import "./dial.css";
import { el, places, svg, text, wind } from "./dom";
import type { Seat, Snapshot } from "./protocol";

type KongRoll = { seat: Seat; dice: readonly [number, number]; lowerDie: number };
type DialGame = NonNullable<Snapshot["game"]> & { kongRoll?: KongRoll };

const pipFaces = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const isDie = (value: number) => Number.isInteger(value) && value >= 1 && value <= 6;

export class HallDial {
  private readonly plate = el("div", "hall-dial-plate");
  private readonly winds = places.map(place => {
    const node = el("span", `hall-dial-wind hall-dial-wind--${place}`);
    this.plate.append(node);
    return node;
  });
  private readonly dice = [0, 1].map(() => svg("svg", { class: "hall-dial-die", viewBox: "0 0 16 16" }));
  private readonly low = el("span", "hall-dial-low");
  private readonly results = el("div", "hall-dial-roll", ...this.dice, this.low);
  private readonly description = el("span", "sr-only");
  private rollKey = "";
  private animation: Animation[] = [];

  constructor(center: HTMLElement) {
    this.plate.setAttribute("aria-hidden", "true");
    this.results.setAttribute("aria-hidden", "true");
    this.results.hidden = true;
    center.classList.add("board-center--dial");
    center.append(this.plate, this.results, this.description);
  }

  present(state: Snapshot, liveMotion = false): void {
    const game = state.game as DialGame | null;
    const current = game?.turnSeat ?? game?.window?.trigger?.seat;
    const offset = current === undefined ? -1 : (current - state.self.seat + 4) % 4;
    this.plate.dataset.lit = places[offset] ?? "";
    this.winds.forEach((node, i) => {
      const seat = ((state.self.seat + i) % 4) as Seat;
      text(node, game ? wind(seat, game.dealerSeat)[0] : "");
      node.toggleAttribute("data-lit", i === offset);
    });

    const still = state.room.paused || document.hidden || document.documentElement.dataset.reducedMotion === "true" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) this.clear();
    const roll = game?.kongRoll;
    const valid = roll && roll.dice.length === 2 && roll.dice.every(isDie) && isDie(roll.lowerDie);
    const key = valid ? `${state.roomId}:${game!.handNumber}:${game!.window?.windowId ?? state.gameRevision}` : "";
    if (key === this.rollKey) return;
    this.clear();
    this.rollKey = key;
    this.results.hidden = !valid;
    if (!valid) {
      text(this.description, "");
      return;
    }

    this.dice.forEach((face, i) => face.replaceChildren(...pipFaces[roll.dice[i] - 1].map(pip =>
      svg("circle", { cx: 4 + pip % 3 * 4, cy: 4 + Math.floor(pip / 3) * 4, r: 1.2 }))));
    text(this.low, `Low ${roll.lowerDie}`);
    text(this.description, `Kong roll: ${roll.dice.join(" and ")}. Lower die: ${roll.lowerDie}.`);
    if (liveMotion && !still) {
      this.animation = this.dice.map((die, i) => die.animate([
        { transform: `translateY(-3px) rotate(${i ? 42 : -38}deg) scale(.8)` },
        { transform: `translateY(1px) rotate(${i ? -14 : 16}deg)` },
        { transform: "none" },
      ], { duration: 230, easing: "ease-out" }));
    }
  }

  clear(): void {
    this.animation.forEach(animation => animation.cancel());
    this.animation = [];
  }
}

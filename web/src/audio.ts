import { defaultPreferences } from "./protocol";
import type { Preferences } from "./protocol";

type Effect = "select" | "turn" | "settle";

const chords = [
  [146.83, 220, 293.66], [130.81, 196, 261.63], [110, 164.81, 261.63], [146.83, 174.61, 220],
];

export class LanternAudio {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private prefs = defaultPreferences;
  private musicTimer = 0;
  private chord = 0;
  private activating = false;
  private unavailable = false;

  constructor() {
    window.addEventListener("pointerdown", () => void this.unlock(), { passive: true });
    window.addEventListener("keydown", () => void this.unlock());
    document.addEventListener("visibilitychange", () => this.updateBuses());
  }

  get note(): string {
    if (this.unavailable) return "Audio is unavailable in this browser; the game remains playable.";
    if (this.context?.state !== "running") return "Your browser may keep audio muted until you interact with the page.";
    return "Original synthesized cues and quiet table music. No audio files are downloaded.";
  }

  async unlock(explicit = false): Promise<void> {
    if (this.activating || this.unavailable || this.context?.state === "running" ||
      (!explicit && !this.prefs.sound && !this.prefs.music)) return;
    this.activating = true;
    try {
      if (!this.context) {
        const Safari = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const Context = window.AudioContext ?? Safari;
        if (!Context) {
          this.unavailable = true;
          return;
        }
        this.context = new Context();
        this.effects = this.context.createGain();
        this.music = this.context.createGain();
        this.effects.connect(this.context.destination);
        this.music.connect(this.context.destination);
      }
      await this.context.resume();
      this.updateBuses();
    } catch { /* Autoplay restrictions do not block play. */ }
    finally { this.activating = false; }
  }

  configure(prefs: Preferences): void {
    this.prefs = prefs;
    document.documentElement.dataset.reducedMotion = String(prefs.reducedMotion);
    this.updateBuses();
  }

  play(effect: Effect): void {
    if (!this.effects || this.context?.state !== "running" || !this.prefs.sound || document.hidden) return;
    if (effect === "select") this.tone(this.effects, 370, 0, .07, .14, "triangle");
    if (effect === "turn") {
      this.tone(this.effects, 523.25, 0, .24, .12);
      this.tone(this.effects, 659.25, .085, .27, .09);
    }
    if (effect === "settle") {
      [293.66, 369.99, 440].forEach((frequency, index) => this.tone(this.effects!, frequency, index * .11, .38, .11));
    }
  }

  private updateBuses(): void {
    if (!this.context || !this.effects || !this.music) return;
    const visible = !document.hidden;
    this.effects.gain.setTargetAtTime(this.prefs.sound && visible ? this.prefs.volume : 0, this.context.currentTime, .02);
    this.music.gain.setTargetAtTime(this.prefs.music && visible ? this.prefs.volume : 0, this.context.currentTime, .02);
    const listening = this.prefs.music && this.prefs.volume > 0 && visible && this.context.state === "running";
    if (listening && !this.musicTimer) {
      this.playChord();
      this.musicTimer = window.setInterval(() => this.playChord(), 2300);
    } else if (!listening && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = 0;
    }
  }

  private playChord(): void {
    if (!this.music || this.context?.state !== "running") return;
    const next = chords[this.chord++ % chords.length];
    next.forEach((frequency, index) => this.tone(this.music!, frequency, .14 * index, 1.28, .035));
  }

  private tone(bus: AudioNode, frequency: number, wait: number, duration: number, level: number, wave: OscillatorType = "sine"): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const time = context.currentTime + wait;
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + .017);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(bus);
    oscillator.start(time);
    oscillator.stop(time + duration);
    oscillator.addEventListener("ended", () => { oscillator.disconnect(); gain.disconnect(); }, { once: true });
  }
}

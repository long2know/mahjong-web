import { defaultPreferences } from "./protocol";
import type { Preferences } from "./protocol";
import type { TableCue } from "./table";

type Effect = "select" | TableCue;

const chords = [
  [146.83, 220, 293.66], [130.81, 196, 261.63], [110, 164.81, 261.63], [146.83, 174.61, 220],
];

export class LanternAudio {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<AudioScheduledSourceNode, GainNode>();
  private prefs = defaultPreferences;
  private musicTimer = 0;
  private chord = 0;
  private unavailable = false;

  constructor() {
    const activate = (event: Event) => { if (event.isTrusted) void this.unlock(); };
    // Touch and pen grant activation on release, not pointerdown.
    window.addEventListener("pointerdown", event => { if (event.pointerType === "mouse") activate(event); }, { passive: true });
    window.addEventListener("pointerup", event => { if (event.pointerType !== "mouse") activate(event); }, { passive: true });
    window.addEventListener("touchend", activate, { passive: true });
    window.addEventListener("keydown", activate);
    document.addEventListener("visibilitychange", () => this.updateBuses());
  }

  get note(): string {
    if (this.unavailable) return "Audio is unavailable in this browser; the game remains playable.";
    if (this.context?.state !== "running") return "Your browser may keep audio muted until you interact with the page.";
    return "Original synthesized cues and quiet table music. No audio files are downloaded.";
  }

  async unlock(explicit = false): Promise<void> {
    if (this.unavailable || this.context?.state === "running" || navigator.userActivation?.isActive === false ||
      (!explicit && !this.prefs.sound && !this.prefs.music)) return;
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
  }

  configure(prefs: Preferences): void {
    this.prefs = prefs;
    document.documentElement.dataset.reducedMotion = String(prefs.reducedMotion);
    this.updateBuses();
  }

  play(effect: Effect): void {
    const bus = this.effects;
    if (!bus || this.context?.state !== "running" || !this.prefs.sound || !this.prefs.volume || document.hidden) return;
    this.clearEffects();
    switch (effect) {
      case "select":
        this.strike(0, 2450, .024, .085);
        this.tone(bus, 740, 0, .045, .045, "triangle");
        break;
      case "draw":
        this.strike(0, 1060, .072, .065);
        this.tone(bus, 340, .034, .09, .09, "triangle");
        this.tone(bus, 680, .039, .1, .07);
        break;
      case "discard":
        this.strike(0, 1850, .033, .16);
        this.tone(bus, 490, 0, .085, .12, "triangle");
        this.tone(bus, 1330, .006, .045, .06);
        break;
      case "call":
        this.strike(0, 1610, .045, .13);
        this.strike(.06, 2340, .035, .12);
        this.tone(bus, 554.37, .04, .18, .07, "triangle");
        this.tone(bus, 830.61, .1, .25, .09);
        break;
      case "turn":
        this.tone(bus, 392, 0, .17, .08, "triangle");
        this.tone(bus, 587.33, .074, .2, .08);
        break;
      case "win":
        [392, 493.88, 587.33, 783.99].forEach((frequency, index) => {
          this.tone(bus, frequency, index * .085, .39, .105);
          this.tone(bus, frequency * 2.01, index * .085, .21, .027, "triangle");
        });
        break;
      case "exhausted":
        this.tone(bus, 293.66, 0, .32, .09, "triangle");
        this.tone(bus, 196, .12, .43, .11);
        break;
    }
  }

  clearEffects(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const [source, envelope] of this.voices) {
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setTargetAtTime(0, now, .005);
      source.stop(now + .02);
    }
    this.voices.clear();
  }

  private updateBuses(): void {
    if (!this.context || !this.effects || !this.music) return;
    const visible = !document.hidden;
    if (!this.prefs.sound || !this.prefs.volume || !visible) this.clearEffects();
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
    next.forEach((frequency, index) => this.tone(this.music!, frequency, .17 * index, 1.45, .029));
    this.tone(this.music, next[0] / 2, 0, 1.76, .019);
  }

  private tone(bus: AudioNode, frequency: number, wait: number, duration: number, level: number, wave: OscillatorType = "sine"): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    this.voice(oscillator, bus, wait, duration, level, .012);
  }

  private strike(wait: number, frequency: number, duration: number, level: number): void {
    const context = this.context!;
    if (!this.noise) {
      this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * .09), context.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = frequency;
    band.Q.value = .95;
    this.voice(source, this.effects!, wait, duration, level, .002, band);
  }

  private voice(source: AudioScheduledSourceNode, bus: AudioNode, wait: number, duration: number, level: number,
    attack: number, filter?: BiquadFilterNode): void {
    const context = this.context!;
    const gain = context.createGain();
    const time = context.currentTime + wait;
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    source.connect(filter ?? gain);
    filter?.connect(gain);
    gain.connect(bus);
    if (bus === this.effects) this.voices.set(source, gain);
    source.addEventListener("ended", () => {
      this.voices.delete(source);
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(time);
    source.stop(time + duration);
  }
}

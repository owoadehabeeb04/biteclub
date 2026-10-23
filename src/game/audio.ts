// Sound effects, synthesized with the Web Audio API so there are no audio files to find or license.
// Visual-only like fx.ts: it listens to sim events and never touches the sim.
import type { FoodKind } from '../sim/sim.ts';

export interface Audio {
  setEnabled(on: boolean): void;
  /** Browsers only start audio after a tap or key press, so call this from an input handler. */
  resume(): void;
  eat(kind: FoodKind): void;
  burn(): void;
  die(): void;
  count(n: number): void; // countdown beep, n = 3, 2, 1, then 0 for go
  click(): void;
}

type Wave = OscillatorType;

export function createAudio(enabled: boolean): Audio {
  let on = enabled;
  let ctx: AudioContext | null = null;
  let lastBurn = 0;

  const get = (): AudioContext | null => {
    if (!on) return null;
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    } catch { return null; } // no audio support: stay silent
  };

  // one short note: pitch slides from `f` to `to`, quick attack, exponential fade
  const note = (f: number, dur: number, type: Wave, vol: number, to = f, delay = 0) => {
    const c = get();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to !== f) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  };

  const noise = (dur: number, vol: number) => {
    const c = get();
    if (!c) return;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; g.gain.value = vol;
    src.connect(g).connect(c.destination);
    src.start();
  };

  return {
    setEnabled: (v) => { on = v; },
    resume: () => { get(); },
    eat(kind) {
      if (kind === 'berry') note(520, 0.09, 'triangle', 0.18, 780);
      else if (kind === 'beetle') { note(420, 0.08, 'triangle', 0.18, 560); note(560, 0.1, 'triangle', 0.18, 840, 0.07); }
      else if (kind === 'firefly') [660, 880, 1320].forEach((f, i) => note(f, 0.12, 'square', 0.1, f * 1.02, i * 0.07)); // coin-pop
      else note(900, 0.05, 'triangle', 0.1, 1100);
    },
    burn() {
      const now = performance.now();
      if (now - lastBurn < 90) return; // burns come fast while boosting
      lastBurn = now;
      note(180, 0.06, 'sawtooth', 0.05, 120);
    },
    die() { note(320, 0.5, 'sawtooth', 0.2, 50); noise(0.3, 0.2); },
    count(n) { note(n > 0 ? 440 : 880, n > 0 ? 0.12 : 0.25, 'sine', 0.2); },
    click() { note(620, 0.05, 'triangle', 0.12, 760); },
  };
}

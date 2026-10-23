'use client';
import { useEffect, useRef, useState } from 'react';
import { BOOST_MIN, TPS, createGame, maxSpeedLevel, speedLevel, step, type Config, type Difficulty, type Input, type Tile } from '../src/sim/sim.ts';
import { attachInput } from '../src/game/input';
import { startRun } from '../src/game/api';
import { createAudio, type Audio } from '../src/game/audio';
import { createFx } from '../src/game/fx';
import { layout, makeView, pickGrid, render } from '../src/game/render';

/** `runId` is the server-issued run to submit, or null when the server was unreachable (an offline run). */
export interface RunResult { runId: string | null; cfg: Config; inputs: Input[]; ticks: number; score: number; eaten: number; length: number; cause: 'wall' | 'self' | null }

const STEP = 1 / TPS;
const COUNTDOWN_MS = 700; // per number

interface Controls { togglePause(): void }

export default function Game({ best, difficulty, sound, onSound, onQuit, onOver }: {
  best: number; difficulty: Difficulty; sound: boolean;
  onSound: (on: boolean) => void; onQuit: () => void; onOver: (r: RunResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<Controls | null>(null);
  const audioRef = useRef<Audio | null>(null);
  const [hud, setHud] = useState({ score: 0, fill: 0, boosting: false, level: 1 });
  const [touch, setTouch] = useState(false);
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState(0); // 3, 2, 1 before play starts or resumes, 0 when running
  const [soundOn, setSoundOn] = useState(sound);
  const overRef = useRef(onOver);
  overRef.current = onOver;
  const maxLevel = maxSpeedLevel(difficulty);

  audioRef.current ??= createAudio(sound);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next); audioRef.current?.setEnabled(next); onSound(next);
    if (next) audioRef.current?.click();
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const audio = audioRef.current!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTouch(matchMedia('(pointer: coarse)').matches);

    let w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let cancelled = false, raf = 0, started = false;
    let detach = () => {};
    const timers: ReturnType<typeof setTimeout>[] = [];
    // the sim only ticks when neither paused nor counting down
    const hold = { paused: false, counting: true };

    // 3, 2, 1 then go. Used at the start and again after a pause, so fingers can get back on the keys.
    const countdown = () => {
      hold.counting = true;
      const n = reduced ? 1 : 3; // reduced motion: one beat instead of three
      for (let i = 0; i <= n; i++)
        timers.push(setTimeout(() => {
          if (cancelled) return;
          const v = n - i;
          setCount(v); audio.count(v);
          if (v === 0) hold.counting = false;
        }, i * COUNTDOWN_MS));
    };
    const setPause = (p: boolean) => {
      if (!started || hold.paused === p) return;
      hold.paused = p; setPaused(p);
      audio.click();
      if (p) { timers.forEach(clearTimeout); timers.length = 0; setCount(0); hold.counting = false; }
      else countdown();
    };
    ctl.current = { togglePause: () => setPause(!hold.paused) };

    const onKey = (e: KeyboardEvent) => {
      audio.resume();
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!e.repeat) setPause(!hold.paused); }
    };
    // Pause when the window loses focus, but not on touch screens: phones fire blur during ordinary swipes
    // (address bar, notification shade), which paused the game mid-swipe. There, switching apps still pauses via visibilitychange.
    const coarse = matchMedia('(pointer: coarse)').matches;
    const onBlur = () => { if (!coarse) setPause(true); };
    const onVis = () => { if (document.hidden) setPause(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    const unlock = () => audio.resume();
    canvas.addEventListener('pointerdown', unlock);

    (async () => {
      const { cols, rows } = pickGrid(w, h);
      // the server issues the seed so it can replay the run later; offline we fall back to a local seed
      const issued = await startRun(cols, rows, difficulty);
      if (cancelled) return;
      const cfg: Config = { seed: issued?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0], cols, rows, difficulty };
      const s = createGame(cfg);
      const fx = createFx(reduced), view = makeView();
      let prev: Tile[] = s.body.map((b) => ({ ...b }));
      const inputs: Input[] = [];
      const turnQ: number[] = [];
      let lastBoost: 0 | 1 = 0, hudKey = '';
      const input = attachInput(canvas, (d) => { if (turnQ.length < 3) turnQ.push(d); });
      detach = input.detach;
      started = true;
      countdown();

      const tickOnce = () => {
        // hand the sim one queued turn per tick, only if its own 2-turn buffer has room
        const turn = turnQ.length && s.queue.length < 2 ? turnQ.shift()! : -1;
        const boost: 0 | 1 = input.isBoosting() ? 1 : 0;
        const before = s.body.map((b) => ({ ...b }));
        if (turn >= 0 || boost !== lastBoost) { inputs.push({ t: s.tick + 1, d: turn, b: boost }); lastBoost = boost; }
        const ev = step(s, turn, boost);
        if (ev.some((e) => e.type === 'moved')) prev = before;
        fx.onEvents(ev, s);
        for (const e of ev) {
          if (e.type === 'ate') audio.eat(e.kind);
          else if (e.type === 'burn') audio.burn();
          else if (e.type === 'died') audio.die();
        }
      };

      let acc = 0, last = performance.now(), finished = false;
      let animT = 0; // animation clock for bobbing food and the tongue. It stops while paused, so a pause really freezes the picture
      const frame = (nowMs: number) => {
        const dt = Math.min(0.25, (nowMs - last) / 1000);
        last = nowMs;
        const running = !hold.paused && !hold.counting;
        if (running || !s.alive) acc += dt; else acc = 0;
        while (acc >= STEP) { if (s.alive && running) tickOnce(); acc -= STEP; }
        if (!hold.paused) { fx.update(dt); animT += dt; }
        render(ctx, layout(w, h, cols, rows), view, s, prev, s.dir, s.alive && running ? acc / STEP : 0, fx, hold.paused ? 0 : dt, animT);

        const fill = Math.max(0, Math.min(1, (s.body.length - BOOST_MIN + 1) / 12));
        const level = speedLevel(s);
        const boosting = input.isBoosting() && s.alive && s.body.length >= BOOST_MIN;
        const key = `${s.score}|${Math.round(fill * 20)}|${boosting}|${level}`;
        if (key !== hudKey) { hudKey = key; setHud({ score: s.score, fill, boosting, level }); }

        // let the shatter play out before the game over screen
        if (!s.alive && !finished && fx.deadT >= (reduced ? 0.5 : 1.3)) {
          finished = true;
          overRef.current({ runId: issued?.runId ?? null, cfg, inputs, ticks: s.tick, score: s.score, eaten: s.eaten, length: s.body.length, cause: s.cause });
          return;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true; cancelAnimationFrame(raf); detach(); timers.forEach(clearTimeout);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', unlock);
      ctl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a run is fixed to the difficulty it started with
  }, []);

  const pauseBtn = (
    <button className="icon-btn" onClick={() => ctl.current?.togglePause()} aria-label="Pause game" title="Pause (Esc)">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor" /><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor" /></svg>
    </button>
  );
  const soundBtn = (
    <button className="icon-btn" onClick={toggleSound} aria-label={soundOn ? 'Mute sound' : 'Turn sound on'} aria-pressed={!soundOn} title={soundOn ? 'Mute' : 'Sound off'}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
        {soundOn
          ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          : <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
    </button>
  );

  return (
    <div className="game">
      <canvas ref={canvasRef} aria-label="BITECLUB arena" role="img" />
      <div className="hud tl"><div className="panel">
        <div className="label">Score</div>
        <div className="big" style={{ color: 'var(--bc-lime)' }}>{hud.score.toLocaleString()}</div>
      </div></div>
      <div className="hud tc" aria-live="off">
        <div className="panel speed" title="The snake gets faster as your score grows">
          <span className="label">Speed</span>
          <span className="pips" aria-label={`Speed ${hud.level} of ${maxLevel}`}>
            {Array.from({ length: maxLevel }, (_, i) => <i key={i} className={i < hud.level ? 'on' : ''} />)}
          </span>
        </div>
      </div>
      <div className="hud tr"><div className="panel"><div className="label">Best</div><div className="big">{Math.max(best, hud.score).toLocaleString()}</div></div></div>
      <div className="hud-btns">{soundBtn}{pauseBtn}</div>
      <div className="hud bc panel">
        <div className="label meter-top"><span>Boost &middot; burns length</span><span>{touch ? 'Hold or double-tap' : 'Hold space'}</span></div>
        <div className={`meter${hud.boosting ? ' on' : ''}`}><i style={{ width: `${Math.round(hud.fill * 100)}%` }} /></div>
      </div>

      {count > 0 && !paused && <div className="countdown" role="status" aria-live="polite" key={count}>{count}</div>}

      {paused && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <div className="card pause-card">
            <h2 className="big" style={{ fontSize: 36, margin: 0, textAlign: 'center' }}>Paused</h2>
            <p className="note" style={{ textAlign: 'center' }}>{difficulty[0].toUpperCase() + difficulty.slice(1)} &middot; score {hud.score.toLocaleString()}</p>
            <div className="stack">
              <button className="btn" onClick={() => ctl.current?.togglePause()} autoFocus>Resume</button>
              <button className="btn ghost" onClick={toggleSound}>Sound: {soundOn ? 'On' : 'Off'}</button>
              <button className="btn ghost" onClick={onQuit}>Quit to menu</button>
            </div>
            <p className="note" style={{ textAlign: 'center' }}>Quitting ends this run without a score.</p>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect } from 'react';
import type { RunResult } from './Game';
import type { Verify } from './page';
import { TPS } from '../src/sim/sim.ts';

const TITLE = { wall: 'You hit the wall.', self: 'You ate your own tail.' };
const SUB = {
  wall: 'The red and black stripes are not decoration.',
  self: 'Snakes are long. This is the problem.',
};

export default function GameOver({ run, verify, isBest, onAgain, onMenu }: { run: RunResult; verify: Verify | null; isBest: boolean; onAgain: () => void; onMenu: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); onAgain(); }
      else if (e.key === 'Escape') onMenu();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onAgain, onMenu]);

  const secs = Math.floor(run.ticks / TPS);
  const time = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const cause = run.cause ?? 'self';
  const state = verify?.state ?? 'pending';
  const score = state === 'ok' ? verify!.score! : run.score; // once verified, show the server's score
  const status = { pending: 'Verifying run…', ok: 'Run verified', failed: 'Couldn’t verify this run', offline: 'Offline run, not verified' }[state];

  return (
    <main className="floor">
      <div className="screen">
        <img className="mascot" src={isBest ? '/mascot/chomp-rich.svg' : '/mascot/chomp-dead.svg'} alt={isBest ? 'Chomp, rich' : 'Chomp, knocked out'} />
        <h1 className="big" style={{ fontSize: 'clamp(30px, 8vw, 52px)', margin: 0, textAlign: 'center', color: 'var(--bc-red)' }}>{isBest ? 'New best!' : TITLE[cause]}</h1>
        <p className="tagline">{isBest ? `${TITLE[cause]} Worth it.` : SUB[cause]}</p>

        <div className="card" style={{ textAlign: 'center' }}>
          <div className="label">Final score</div>
          <div className="big" style={{ fontSize: 64, color: 'var(--bc-lime)' }}>{score.toLocaleString()}</div>
          <div className="row" style={{ marginTop: 10, gap: 28 }}>
            <div><div className="label">Survived</div><div className="big" style={{ fontSize: 22 }}>{time}</div></div>
            <div><div className="label">Food eaten</div><div className="big" style={{ fontSize: 22 }}>{run.eaten}</div></div>
            <div><div className="label">Length</div><div className="big" style={{ fontSize: 22 }}>{run.length}</div></div>
          </div>
          <div className={`status ${state}`} role="status">{status}{state === 'ok' && verify?.rank ? ` · rank #${verify.rank} on ${run.cfg.difficulty}` : ''}</div>
        </div>

        <div className="row">
          <button className="btn" onClick={onAgain} autoFocus>Play again</button>
          <button className="btn ghost" onClick={onMenu}>Main menu</button>
        </div>
      </div>
    </main>
  );
}

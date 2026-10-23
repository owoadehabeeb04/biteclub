'use client';
import { useEffect, useState } from 'react';
import type { Me } from './page';
import WalletCard from './WalletCard';
import { fetchBoard, type Board, type Settings, type WalletResult } from '../src/game/api';
import { DIFFICULTIES, speedRange, type Difficulty } from '../src/sim/sim.ts';

const mask = (code: string) => `BITE-••••-••••-${code.slice(-4)}`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const cap = (d: string) => d[0].toUpperCase() + d.slice(1);
const rate = (n: number) => (Math.round(n * 10) / 10).toString();
const BLURB: Record<Difficulty, string> = {
  easy: 'A slow, forgiving start and a gentle speed-up.',
  medium: 'The classic pace. Speeds up as you score.',
  hard: 'Fast from the first bite, and it gets frantic. Not for the faint of heart.',
};

export default function Menu({ me, settings, best, onPlay, onSettings, onRestore, onRename, onWalletLinked }: {
  me: Me; settings: Settings; best: number;
  onPlay: () => void;
  onSettings: (patch: Partial<Settings>) => void;
  onRestore: (code: string) => Promise<string | null>;
  onRename: (name: string) => Promise<string | null>;
  onWalletLinked: (r: WalletResult) => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [nameMsg, setNameMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [tab, setTab] = useState<Difficulty>(settings.difficulty);
  const [board, setBoard] = useState<Board | null | 'loading'>('loading');

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // typing a code, or using a button, must not start the game
      if ((e.target as HTMLElement).closest('input, textarea, button, [role="radio"]')) return;
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); onPlay(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onPlay]);

  useEffect(() => { setTab(settings.difficulty); }, [settings.difficulty]);
  useEffect(() => { setName(me.name ?? ''); }, [me.name]);
  // refetch when the tab changes, or when the player's own scores change (a run was verified, or a player was restored)
  useEffect(() => {
    let live = true;
    setBoard('loading');
    fetchBoard(tab).then((b) => live && setBoard(b));
    return () => { live = false; };
  }, [tab, me.games, me.name, me.status]);

  const copy = async () => {
    if (!me.code) return;
    try { await navigator.clipboard.writeText(me.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setReveal(true); /* can't copy: show it so it can be copied by hand */ }
  };
  const restore = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setError(null);
    const err = await onRestore(code);
    setBusy(false);
    if (err) setError(err); else { setCode(''); setReveal(false); }
  };
  const saveName = async () => {
    const n = name.trim();
    if (!n || n === me.name) return;
    setNameMsg(null);
    const err = await onRename(n);
    setNameMsg(err ? { text: err, bad: true } : { text: 'Saved.', bad: false });
  };
  const range = speedRange(settings.difficulty);

  return (
    <main className="floor">
      <div className="screen">
        <img className="mascot" src="/mascot/chomp-idle.svg" alt="Chomp, the BITECLUB snake mascot" />
        <h1 className="logo">BITE<br />CLUB</h1>
        <p className="tagline">BITE. SURVIVE. DOMINATE.</p>
        <button className="btn" onClick={onPlay} autoFocus>Play</button>
        <p className="note" style={{ margin: '-8px 0 0' }}>{cap(settings.difficulty)} &middot; change it in Settings below</p>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">Best score &middot; {cap(settings.difficulty)}</span>
            <span className="big" style={{ fontSize: 28, color: 'var(--bc-lime)' }}>{best.toLocaleString()}</span>
          </div>
          <dl className="keys">
            <dt>MOVE</dt><dd>Arrow keys, WASD, or swipe anywhere</dd>
            <dt>BOOST</dt><dd>Hold space, or hold / double-tap on touch. Burns length.</dd>
            <dt>PAUSE</dt><dd>Esc or P, or the pause button</dd>
            <dt>EAT</dt><dd>Berry +1, beetle +2, firefly +5</dd>
          </dl>
        </div>

        <div className="card" aria-labelledby="settings-h">
          <span className="big" id="settings-h" style={{ fontSize: 18 }}>Settings</span>
          <div className="label" style={{ marginTop: 12 }} id="diff-l">Difficulty</div>
          <div className="seg" role="radiogroup" aria-labelledby="diff-l">
            {DIFFICULTIES.map((d) => (
              <button key={d} role="radio" aria-checked={settings.difficulty === d} className={settings.difficulty === d ? 'on' : ''} onClick={() => onSettings({ difficulty: d })}>{cap(d)}</button>
            ))}
          </div>
          <p className="note">{BLURB[settings.difficulty]} Starts at {rate(range.from)} moves a second and tops out at {rate(range.to)}.</p>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, flexWrap: 'nowrap' }}>
            <span className="label" id="snd-l">Sound</span>
            <button className="switch" role="switch" aria-checked={settings.sound} aria-labelledby="snd-l" onClick={() => onSettings({ sound: !settings.sound })}>
              <span>{settings.sound ? 'On' : 'Off'}</span><i />
            </button>
          </div>
          <p className="note" style={{ marginTop: 10 }}>{me.code ? 'Saved to your player, so it follows your recovery code to any browser.' : 'Saved in this browser for now.'}</p>
        </div>

        <div className="card" aria-labelledby="board-h">
          <span className="big" id="board-h" style={{ fontSize: 18 }}>Leaderboard</span>
          <div className="seg" role="tablist" aria-label="Difficulty" style={{ marginTop: 10 }}>
            {DIFFICULTIES.map((d) => (
              <button key={d} role="tab" aria-selected={tab === d} className={tab === d ? 'on' : ''} onClick={() => setTab(d)}>{cap(d)}</button>
            ))}
          </div>
          {board === 'loading' ? <p className="note" style={{ marginTop: 12 }}>Loading…</p>
            : !board ? <p className="note" style={{ marginTop: 12 }}>The leaderboard needs a connection. Your own scores are still saved here.</p>
            : board.rows.length === 0 ? <p className="note" style={{ marginTop: 12 }}>No scores on {cap(tab)} yet. Be the first.</p>
            : (
              <ol className="board" aria-label={`${cap(tab)} top scores`}>
                {board.rows.map((r) => (
                  <li key={r.rank + r.name} className={r.you ? 'you' : ''}><span>{r.rank}</span><span className="nm">{r.name}{r.you ? ' (you)' : ''}</span><b>{r.score.toLocaleString()}</b></li>
                ))}
                {board.you && !board.rows.some((r) => r.you) && (
                  <li className="you gap"><span>{board.you.rank}</span><span className="nm">{me.name ?? 'You'} (you)</span><b>{board.you.score.toLocaleString()}</b></li>
                )}
              </ol>
            )}
          <p className="note" style={{ marginTop: 10 }}>Only runs the server has verified count.</p>
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="big" style={{ fontSize: 18 }}>Your player</span>
            <span className="label">{me.status === 'online' ? `${me.games} verified run${me.games === 1 ? '' : 's'}` : me.status === 'loading' ? 'Loading…' : 'Offline'}</span>
          </div>

          {me.code ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0 6px', gap: 8 }}>
                <code className="code" aria-label="Recovery code">{reveal ? me.code : mask(me.code)}</code>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <button className="mini" onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide' : 'Show'}</button>
                  <button className="mini" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                </span>
              </div>
              <p className="note">This code is your password. Anyone who has it can play as you. Save it to get your scores back in another browser, or if this one gets cleared.</p>

              <div className="label" style={{ marginTop: 14 }}>Leaderboard name</div>
              <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'nowrap' }}>
                <input
                  className="field" value={name} placeholder="Pick a name" maxLength={16} autoComplete="off" spellCheck={false}
                  aria-label="Leaderboard name" aria-invalid={!!nameMsg?.bad} onChange={(e) => { setName(e.target.value); setNameMsg(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
                />
                <button className="mini" onClick={saveName} disabled={!name.trim() || name.trim() === me.name}>Save</button>
              </div>
              {nameMsg
                ? <p className={nameMsg.bad ? 'err' : 'note'} role={nameMsg.bad ? 'alert' : 'status'} style={{ margin: '8px 0 0' }}>{nameMsg.text}</p>
                : <p className="note" style={{ margin: '8px 0 0' }}>3 to 16 letters, numbers, - or _. Until you pick one you show as snake-XXXX.</p>}
            </>
          ) : (
            <p className="note" style={{ margin: '10px 0' }}>{me.status === 'loading' ? 'Setting up your player…' : 'Can’t reach the server, so scores are only saved in this browser for now. Your player is created next time you’re online.'}</p>
          )}

          {me.recent.length > 0 && (
            <ul className="history" aria-label="Recent runs">
              {me.recent.slice(0, 5).map((r) => (
                <li key={r.at}><span>{day(r.at)}</span><span>{r.difficulty}</span><span>{r.cause === 'wall' ? 'wall' : 'tail'}</span><b>{r.score.toLocaleString()}</b></li>
              ))}
            </ul>
          )}

          <div className="label" style={{ marginTop: 14 }}>Restore a player</div>
          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: 'nowrap' }}>
            <input
              className="field" value={code} placeholder="BITE-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false}
              aria-label="Recovery code" aria-invalid={!!error} onChange={(e) => { setCode(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') restore(); }}
            />
            <button className="mini" onClick={restore} disabled={busy || !code.trim()}>{busy ? '…' : 'Restore'}</button>
          </div>
          {error ? <p className="err" role="alert">{error}</p> : <p className="note" style={{ margin: '8px 0 0' }}>Switches this browser to that player. Copy your current code first.</p>}
        </div>

        <WalletCard me={me} onLinked={onWalletLinked} />

        <p className="fine">
          $BITE is a testnet token with no cash value. It is not an investment and carries no promise of returns, listings or appreciation.
          BITECLUB is not affiliated with Robinhood and never asks for a seed phrase or private key.
        </p>
      </div>
    </main>
  );
}

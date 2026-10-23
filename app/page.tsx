'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Menu from './Menu';
import Game, { type RunResult } from './Game';
import GameOver from './GameOver';
import type { WalletResult } from '../src/game/api';
import {
  DEFAULT_SETTINGS, cacheBest, cacheSettings, cachedBests, cachedSettings, fetchBoard, fetchMe, loadPlayer, restorePlayer,
  saveName, saveSettings, savedPlayer, submitRun, type HistoryRun, type PlayerStats, type Settings,
} from '../src/game/api';
import type { Difficulty } from '../src/sim/sim.ts';

export interface Me {
  status: 'loading' | 'online' | 'offline';
  code: string | null;
  name: string | null;
  wallet: string | null; // lowercase address once a wallet is linked
  bests: Record<Difficulty, number>;
  games: number;
  recent: HistoryRun[];
}
export type Verify = { runId: string | null; state: 'pending' | 'ok' | 'failed' | 'offline'; score?: number; rank?: number };

const NONE: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
const fromStats = (s: PlayerStats): Me => ({ status: 'online', code: savedPlayer()?.code ?? null, name: s.name, wallet: s.wallet, bests: s.bests, games: s.games, recent: s.recent });

export default function Page() {
  const [screen, setScreen] = useState<'menu' | 'playing' | 'over'>('menu');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [localBests, setLocalBests] = useState(NONE); // this browser's own bests, the offline fallback
  const [me, setMe] = useState<Me>({ status: 'loading', code: null, name: null, wallet: null, bests: NONE, games: 0, recent: [] });
  const [run, setRun] = useState<RunResult | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [isBest, setIsBest] = useState(false);
  const [round, setRound] = useState(0); // remounts Game for "play again"
  const best = Math.max(localBests[settings.difficulty], me.bests[settings.difficulty]);
  const bestRef = useRef(0);
  bestRef.current = best;

  useEffect(() => {
    setSettings(cachedSettings());
    setLocalBests(cachedBests());
    loadPlayer().then((s) => {
      setLocalBests(cachedBests()); // re-read: a server that forgot this player clears the old local bests
      if (!s) return setMe({ status: 'offline', code: savedPlayer()?.code ?? null, name: null, wallet: null, bests: NONE, games: 0, recent: [] });
      setMe(fromStats(s));
      setSettings(s.settings); // the server copy follows the recovery code, so it wins
      cacheSettings(s.settings);
    });
  }, []);

  const change = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      cacheSettings(next);
      return next;
    });
    void saveSettings(patch); // saved on the server with the player. Offline, the local copy still applies
  }, []);

  const play = useCallback(() => { setRound((r) => r + 1); setScreen('playing'); }, []);
  const menu = useCallback(() => setScreen('menu'), []);

  const over = useCallback((r: RunResult) => {
    const d = r.cfg.difficulty;
    const nb = r.score > bestRef.current && r.score > 0;
    setIsBest(nb && r.score >= 10); // rich face only for a real high score
    if (nb) { cacheBest(d, r.score); setLocalBests((b) => ({ ...b, [d]: r.score })); }
    setRun(r);
    setScreen('over');
    if (!r.runId) return setVerify({ runId: null, state: 'offline' });
    setVerify({ runId: r.runId, state: 'pending' });
    // the server replays the inputs and answers with its own score
    submitRun(r.runId, { inputs: r.inputs, ticks: r.ticks, score: r.score }).then(async (res) => {
      setVerify({ runId: r.runId, state: res.ok ? 'ok' : 'failed', score: res.ok ? res.score : undefined });
      if (!res.ok) return;
      const [s, board] = await Promise.all([fetchMe(), fetchBoard(d)]);
      if (s) setMe(fromStats(s));
      const rank = board?.you?.rank;
      if (rank) setVerify((v) => (v?.runId === r.runId ? { ...v, rank } : v));
    });
  }, []);

  const restore = useCallback(async (code: string): Promise<string | null> => {
    const res = await restorePlayer(code);
    if (!res.ok) return res.error;
    setMe(fromStats(res.stats));
    setSettings(res.stats.settings); // settings come back with the player
    cacheSettings(res.stats.settings);
    return null;
  }, []);

  // Signing in with a wallet can hand this browser a different player (and a new credential), so take everything from the server again
  const walletLinked = useCallback((r: WalletResult) => {
    setMe(fromStats(r.stats));
    setSettings(r.stats.settings);
    cacheSettings(r.stats.settings);
    if (r.switched || r.created) setLocalBests(NONE); // the old local bests belonged to the player this browser left
  }, []);

  const rename = useCallback(async (name: string): Promise<string | null> => {
    const res = await saveName(name);
    if (!res.ok) return res.error;
    setMe((m) => ({ ...m, name: res.name }));
    return null;
  }, []);

  if (screen === 'playing')
    return <Game key={round} best={best} difficulty={settings.difficulty} sound={settings.sound} onSound={(sound) => change({ sound })} onQuit={menu} onOver={over} />;
  if (screen === 'over' && run)
    return <GameOver run={run} verify={verify?.runId === run.runId ? verify : null} isBest={isBest} onAgain={play} onMenu={menu} />;
  return <Menu me={me} settings={settings} best={best} onPlay={play} onSettings={change} onRestore={restore} onRename={rename} onWalletLinked={walletLinked} />;
}

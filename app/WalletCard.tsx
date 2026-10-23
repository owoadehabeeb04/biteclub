'use client';
import { useEffect, useState } from 'react';
import { useConnect, useConnection, useConnectors, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { createSiweMessage } from 'viem/siwe';
import { robinhoodTestnet } from '../src/chain';
import { fetchNonce, verifyWallet, type WalletResult } from '../src/game/api';
import type { Me } from './page';

const STATEMENT = 'Sign in to BITECLUB. This is free and sends nothing to the blockchain.';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const why = (e: unknown) => {
  const m = (e as Error)?.message ?? '';
  if ((e as { code?: number })?.code === 4001 || /reject|denied|cancel/i.test(m)) return 'You cancelled that in your wallet.';
  return m.split('\n')[0].slice(0, 140) || 'Something went wrong.';
};

export default function WalletCard({ me, onLinked }: { me: Me; onLinked: (r: WalletResult) => void }) {
  const { address, chainId, isConnected, connector } = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connect, isPending: connecting } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: signMessage } = useSignMessage();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false); // the list of wallets
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ games: number; message: string; signature: string } | null>(null);
  useEffect(() => setMounted(true), []);

  // Wallets announce themselves by name. The generic entry is only for older wallets that don't.
  const named = connectors.filter((c) => c.id !== 'injected');
  const hasGeneric = mounted && named.length === 0 && typeof (window as { ethereum?: unknown }).ethereum !== 'undefined';

  const mine = me.wallet && address ? me.wallet === address.toLowerCase() : false;
  const wrongNetwork = isConnected && chainId !== robinhoodTestnet.id;

  async function doConnect(c: (typeof connectors)[number]) {
    setMsg(null);
    try { await connect({ connector: c }); setOpen(false); } catch (e) { setMsg({ text: why(e), bad: true }); }
  }

  async function finish(message: string, signature: string, switchOk: boolean) {
    const res = await verifyWallet(message, signature, switchOk);
    if (res.ok) {
      setConfirm(null);
      onLinked(res.result);
      setMsg({
        text: res.result.switched || (res.result.code && !res.result.created) ? 'Signed in. This browser now has your wallet’s player, with its scores and settings.'
          : res.result.created ? 'Signed in with a new player linked to this wallet.' : 'Wallet linked to your player.',
        bad: false,
      });
    } else if (res.needsConfirm) {
      setConfirm({ games: res.needsConfirm.games, message, signature });
    } else setMsg({ text: res.error, bad: true });
  }

  async function signIn() {
    if (!address || busy) return;
    setBusy(true); setMsg(null); setConfirm(null);
    try {
      const nonce = await fetchNonce();
      if (!nonce) throw new Error('Can’t reach the server. Try again.');
      const now = new Date();
      const message = createSiweMessage({
        address, chainId: chainId ?? robinhoodTestnet.id, domain: location.host, nonce, uri: location.origin, version: '1',
        statement: STATEMENT, issuedAt: now, expirationTime: new Date(now.getTime() + 10 * 60_000),
      });
      const signature = await signMessage({ message });
      await finish(message, signature, false);
    } catch (e) { setMsg({ text: why(e), bad: true }); } finally { setBusy(false); }
  }

  async function switchNetwork() {
    setMsg(null);
    try { await switchChain({ chainId: robinhoodTestnet.id }); } catch (e) { setMsg({ text: why(e), bad: true }); }
  }

  return (
    <div className="card" aria-labelledby="wallet-h">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="big" id="wallet-h" style={{ fontSize: 18 }}>Wallet</span>
        {isConnected && address
          ? <span className={`chip ${wrongNetwork ? 'bad' : mine ? 'ok' : 'neutral'}`}>{wrongNetwork ? 'Wrong network' : mine ? 'Linked' : 'Connected'}</span>
          : me.wallet ? <span className="chip ok">Linked</span> : <span className="chip neutral">Not connected</span>}
      </div>

      {!isConnected && (
        <>
          <p className="note" style={{ margin: '8px 0 0' }}>
            {me.wallet ? <>Your player is linked to <b>{short(me.wallet)}</b>. Connect it to use it again.</>
              : <>Link a wallet to your player. You can then sign in with it in any browser, and it is where $BITE rewards will go.</>}
          </p>
          {!open
            ? <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setOpen(true)} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>
            : (
              <div className="wallets" role="group" aria-label="Choose a wallet">
                {mounted && named.map((c) => (
                  <button key={c.uid} className="wallet-btn" onClick={() => doConnect(c)} disabled={connecting}>
                    {c.icon && <img src={c.icon} alt="" width={24} height={24} />}<span>{c.name}</span>
                  </button>
                ))}
                {hasGeneric && (
                  <button className="wallet-btn" onClick={() => doConnect(connectors.find((c) => c.id === 'injected')!)} disabled={connecting}><span>Browser wallet</span></button>
                )}
                {mounted && named.length === 0 && !hasGeneric && (
                  <p className="note" style={{ margin: 0 }}>
                    No wallet found in this browser. Install one such as MetaMask or Rabby, then reload. On a phone, open this page inside your wallet app’s own browser.
                  </p>
                )}
                <button className="mini" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            )}
        </>
      )}

      {isConnected && address && (
        <>
          <p className="note" style={{ margin: '8px 0 0' }}>
            <b>{short(address)}</b>{connector ? ` · ${connector.name}` : ''}
          </p>

          {wrongNetwork && (
            <div style={{ marginTop: 10 }}>
              <p className="err" style={{ margin: '0 0 8px' }}>Your wallet is on a different network. Rewards need {robinhoodTestnet.name}.</p>
              <button className="btn ghost" onClick={switchNetwork} disabled={switching}>{switching ? 'Switching…' : `Switch to ${robinhoodTestnet.name}`}</button>
            </div>
          )}

          {!mine && !confirm && (
            <div style={{ marginTop: 12 }}>
              {me.wallet && <p className="note" style={{ margin: '0 0 8px' }}>Your player is linked to a different wallet, <b>{short(me.wallet)}</b>. Signing in with this one switches to whichever player it belongs to.</p>}
              <button className="btn" style={{ fontSize: 18, padding: '10px 24px', minHeight: 48 }} onClick={signIn} disabled={busy}>
                {busy ? 'Check your wallet…' : me.wallet ? 'Sign in with this wallet' : 'Sign in to link wallet'}
              </button>
              <p className="note" style={{ margin: '8px 0 0' }}>Signing is free and sends nothing to the blockchain.</p>
            </div>
          )}

          {confirm && (
            <div className="notice" role="alertdialog" aria-label="Switch players?">
              <p style={{ margin: 0 }}><b>This wallet belongs to a different player.</b> Signing in switches this browser to that player. Your current player, with {confirm.games} verified run{confirm.games === 1 ? '' : 's'}, stays safe under its own recovery code.</p>
              <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-start' }}>
                <button className="mini" onClick={async () => { setBusy(true); try { await finish(confirm.message, confirm.signature, true); } finally { setBusy(false); } }} disabled={busy}>Switch players</button>
                <button className="mini" onClick={() => { setConfirm(null); setMsg(null); }}>Cancel</button>
              </div>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 12 }}>
            <button className="mini" onClick={() => { disconnect(); setMsg(null); setConfirm(null); }}>Disconnect</button>
            {mine && <span className="note" style={{ margin: 0 }}>Disconnecting doesn’t unlink it from your player.</span>}
          </div>
        </>
      )}

      {msg && <p className={msg.bad ? 'err' : 'note'} role={msg.bad ? 'alert' : 'status'} style={{ margin: '10px 0 0' }}>{msg.text}</p>}

      <p className="note" style={{ margin: '12px 0 0' }}>$BITE rewards: coming soon. BITECLUB never asks for a seed phrase or private key.</p>
    </div>
  );
}

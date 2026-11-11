'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http, injected } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { robinhoodTestnet } from '../src/chain';

// A free project ID from Reown (WalletConnect). It is public, not a secret. Without it, WalletConnect is simply left out
// and browser wallets still work.
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Browser wallets announce themselves to the page (EIP-6963), so MetaMask, Rabby, the Coinbase extension and others show up by
// name. WalletConnect adds mobile wallets: on a phone it opens the wallet app, on a computer it shows a QR code to scan.
const config = createConfig({
  chains: [robinhoodTestnet],
  connectors: [
    injected(), // a fallback for wallets that don't announce themselves
    ...(PROJECT_ID
      ? [walletConnect({
          projectId: PROJECT_ID,
          showQrModal: true,
          metadata: {
            name: 'BITECLUB',
            description: 'Bite. Survive. Dominate.',
            // wallets check this against the real address of the page, so use the page's own origin
            url: typeof window !== 'undefined' ? window.location.origin : 'https://biteclub.invalid',
            icons: [typeof window !== 'undefined' ? `${window.location.origin}/icon.svg` : ''],
          },
        })]
      : []),
  ],
  transports: { [robinhoodTestnet.id]: http() },
  ssr: true,
});

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

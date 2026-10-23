'use client';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http, injected } from 'wagmi';
import { robinhoodTestnet } from '../src/chain';

// Browser wallets only. Wallets announce themselves to the page (EIP-6963), so MetaMask, Rabby, the Coinbase
// extension and others show up by name with no setup. WalletConnect (mobile wallets) is not added yet.
const config = createConfig({
  chains: [robinhoodTestnet],
  connectors: [injected()], // a fallback for wallets that don't announce themselves
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

// Robinhood Chain Testnet. Values come from Robinhood's own docs page https://docs.robinhood.com/chain/connecting
// (read 2026-10-23): chain ID 46630, ETH as the gas token, public RPC https://rpc.testnet.chain.robinhood.com
// (rate-limited, "not recommended for production"), explorer explorer.testnet.chain.robinhood.com.
// The docs list the explorer without a scheme, so https:// is an assumption. Re-check this file against the docs before launch.
import { defineChain } from 'viem';

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
});

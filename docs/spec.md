# BITECLUB build spec (DRAFT, reconstructed)

> **Status: draft written by Claude, not the owner's original spec.** The original six-milestone handoff was never in this folder. This file is rebuilt from `CLAUDE.md` only. Milestone order and scope below are assumptions. Replace this file with the real spec when it turns up, and the plan changes with it.

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| 1 | Playable offline game (solo, Canvas 2D, v2 look, local best) | Done |
| 2 | Server replay, verified scores, anonymous players with recovery codes | Built and tested locally. Needs the Postgres swap before deploy |
| 3 | Wallet connect and SIWE sign-in | Built and tested with a fake wallet. Not yet tried with a real wallet |
| 4 | $BITE token and reward distributor (Foundry, testnet) | |
| 5 | EIP-712 reward claims | |
| 6 | Polish: leaderboard, landing page, cosmetics, launch checks | |

## Rules that apply to every milestone

- The simulation (`src/sim/sim.ts`) stays pure: fixed tick, seeded integer PRNG, integer tiles, no DOM, no `Math.random`. The server imports the same module the client does.
- A run is `{ cfg: {seed, cols, rows}, inputs: [{t, d, b}], ticks }`. The server replays it and recomputes the score. A score sent by the client is never trusted.
- The token has no mint function reachable by the game server. Rewards come from a distributor contract with a fixed supply, plus per-wallet and daily caps.
- Claims are EIP-712 signed by a server signer, with a nonce, an expiry and replay protection. Wallet sign-in is SIWE (EIP-4361).
- Do not hard-code chain ID, RPC or explorer values from memory. Verify them against the official Robinhood Chain docs first.
- Copy that must stay: $BITE is a testnet token with no cash value, not an investment, no promise of returns, listings or appreciation. No implied Robinhood affiliation. BITECLUB never asks for a seed phrase or private key.

## 2. Server replay and verified scores (plan)

Goal: the server can take a finished run and say "this score is real". No wallet, no token yet.

**Stack (owner decision, overrides CLAUDE.md):** one Next.js app on Vercel, client and server together. No NestJS. The API is Next.js route handlers (`app/api/...`) that import `src/sim/sim.ts` by path. Postgres via Prisma (e.g. Vercel Postgres) and Redis via Upstash. Revisit a separate backend only if the server logic outgrows route handlers.

**Flow**
1. Client asks `POST /runs` for a run. Server returns `{ runId, seed }`, so the seed is server-issued rather than client-chosen, and stores it in Redis with a short TTL.
2. Client plays, recording inputs as it does today.
3. Client sends `POST /runs/:id/submit` with `{ cols, rows, inputs, ticks }`.
4. Server loads the issued seed, calls `replay(cfg, inputs, ticks)`, and takes `score`, `eaten`, `ticks` and `alive` from the result. It stores those, never the client's numbers.
5. Run is marked `verified`. A run id can be submitted once.

**Validation (trust boundary)**
- Input count and size caps. `t` strictly increasing and within `ticks`. `d` in `-1..3`, `b` in `0|1`. `cols` and `rows` inside the range the client can produce.
- Max `ticks` per run, and a minimum plausible wall-clock time (issued-at to submitted-at at 20 ticks per second, with slack), so a run cannot be submitted faster than it could be played.
- Rate limit per IP.

**Data (Prisma)**: `Run { id, seed, cols, rows, ticks, score, eaten, length, cause, verified, createdAt, submittedAt }`, with a unique constraint on the issued seed per run and an index on score for the leaderboard.

**Client changes**: `app/page.tsx` already has the seam in `over()`. Add an API client, a "verifying..." state on game over, and a graceful offline path (the game stays playable and the local best still works if the server is down).

**Tests**
- Replay of a client-recorded run on the server matches the client score, using the same `sim.ts`.
- Tampered inputs, forged seed, resubmitted run, oversize payload and too-fast submission are all rejected.

**Decisions (defaults agreed with the owner)**
- Max run length: 30 minutes, 36,000 ticks.
- Play stays anonymous until the wallet milestone.
- Hosting: Vercel. `src/sim/` is imported by path, no shared package.

### 2 as built

- **Players:** anonymous. `POST /api/players` makes one and returns a recovery code (`BITE-XXXX-XXXX-XXXX`, 60 bits) once. The server keeps only a SHA-256 hash. The browser keeps the code in localStorage and sends it as the `x-player-code` header. Typing the code in another browser (`POST /api/players/restore`) restores the same player, best score and history. Anyone holding the code controls that player, and there is no recovery if it is lost until wallet sign-in (milestone 3).
- **Runs:** `POST /api/runs` issues the seed. `POST /api/runs/:id/submit` replays the inputs with `sim.ts` and stores the server's score. One attempt per issued run. Play without a player still verifies but belongs to nobody.
- **Storage:** `src/server/store.ts` behind a `Store` interface, on Node's built-in SQLite (`.data/biteclub.db`, or the `BITECLUB_DB` env var). Prisma was skipped to avoid native dependencies. **Before deploying to Vercel, re-implement `store.ts` on Postgres:** Vercel's disk is not persistent.
- **Rate limits** (`src/server/http.ts`) are per server instance. Move them to Redis (Upstash) on deploy.
- **Offline:** if the server is unreachable the game still plays. The run is marked "Offline run, not verified" and uses a local seed.
- **Speed and difficulty (in the simulation):** the sim ticks at 60 per second and the snake starts slow and speeds up as the score grows, down to a floor. Easy, medium and hard differ in start speed, ramp rate and top speed (see `SPEED` in `src/sim/sim.ts`). Difficulty is part of `Config`, chosen when a run is issued and stored with it, so the server replays with the same rules. Changing any of these numbers changes how old runs replay.
- **Settings (difficulty, sound):** stored on the player's server record and returned with `/me` and restore, so they follow the recovery code. The browser keeps a copy for offline play, and the server copy wins when online. `PUT /api/players/me/settings`.
- **Leaderboard:** one board per difficulty, each player's best verified score, ties share a rank, zero scores left out. Players pick a display name (`PUT /api/players/me/name`, 3 to 16 letters, numbers, `-` or `_`, unique ignoring case) and show as `snake-XXXX` until they do. `GET /api/leaderboard?difficulty=` includes the caller's own rank when a player code is sent. Names pass a small profanity check and a reserved list (including anything implying Robinhood). That check is deliberately basic: add real moderation if names get abused.
- **In-game:** pause (icon, Esc or P, and auto-pause when the tab loses focus) with a 3-2-1 countdown on start and resume, sound effects synthesized in the browser, a mute toggle, and a speed readout. Quitting from the pause menu ends the run without a score. An issued run stays valid for 2 hours so a paused game can still finish.
- **Database upgrades:** `createStore` adds new columns to an existing database on startup, so no data is lost. Runs from before difficulty existed are filed under medium and were played under the old 20-tick rules, so they won't replay.
- **Not done:** a way to rotate or revoke a leaked code, attaching a player to a wallet, and weekly leaderboards.

### 3 as built (wallet sign-in)

- **Flow:** connect a browser wallet (found automatically via EIP-6963, so MetaMask, Rabby and others appear by name), then sign a SIWE (EIP-4361) message. `GET /api/wallet/nonce` issues a one-time nonce (5 minutes, single use, stored in the `siwe_nonces` table). `POST /api/wallet/verify` checks the signature and links the wallet.
- **What the server checks:** the signed domain and uri must be the request's own host (a message signed for another site is rejected), issuedAt and expirationTime must be recent and no more than 15 minutes apart, the recovered address must match the address in the message, and the nonce must be unspent. Plain 65-byte (externally owned account) signatures only.
- **Linking rules:** one wallet per player and one player per wallet (`players.wallet`, unique, stored lowercase).
  - Wallet unlinked, browser has a player: the wallet is linked to that player.
  - Wallet linked to a different player: this browser switches to the wallet's player. The server mints a new credential for it and returns the code once (the server only stores hashes, so it cannot show the original). If the browser's current player has verified runs, the server first answers `needs_confirm` without spending the nonce and the menu asks. The player left behind stays reachable under its own recovery code.
  - The browser's player is already linked to a different wallet and the new wallet is unlinked: refused.
- **Credentials:** a player can now have several, one per browser. The original recovery code stays in `players.code_hash`, extra ones live in the `credentials` table.
- **Chain:** `src/chain.ts` holds Robinhood Chain Testnet (46630, ETH, public RPC) from docs.robinhood.com/chain/connecting, read 2026-10-23. The explorer URL's `https://` is an assumption. Sign-in works on any network. The menu shows a red "Wrong network" state with a switch button, because claims will need this chain.
- **Not done:** WalletConnect (mobile wallets), smart-contract wallets (ERC-1271, needs an on-chain check), unlinking a wallet, revoking one browser's credential. On a phone the wallet only works inside a wallet app's own browser.
- **Verified by:** unit tests with throwaway keys, and a browser test with a fake wallet that signs for real. Real MetaMask, Rabby and Coinbase Wallet have not been tried.

## 4 to 6 (one-line scope only, to be planned when reached)
- **4 Token and distributor:** Foundry. Fixed-supply ERC-20, distributor with per-wallet and daily caps, no server-reachable mint.
- **5 Claims:** server signs EIP-712 claims for verified runs, with nonce and real expiry. Claim states UI from `pages/app-reward-claim-states.html`, restyled to v2. Reward tiers and limits are not defined yet and need an owner decision.
- **6 Polish:** leaderboard from verified runs, v2 landing page, cosmetic skins from `tokens-v2.json`, final branding check for existing BITECLUB or $BITE projects.

# BITECLUB ($BITE): build brief for Claude Code

Read this first. It is the handoff from the design phase.

## What we are building

A browser snake game with a crypto-game feel. Wallet connect is optional. Scores are verified by the server. Players can claim $BITE, an ERC-20 testnet token on Robinhood Chain Testnet, through EIP-712 signed reward claims.

Tagline: "Bite. Survive. Dominate."

## Decisions already made

- **Gameplay is classic Nokia-style snake on a grid.** The snake steps one tile per tick, turns 90 degrees only, and cannot reverse into its own neck. Several snakes (the player plus bots with their own skins) share one grid arena.
- **Controls, same on every device:**
  - Phone and touch: swipe anywhere on screen. The swipe direction is the new direction. Use a minimum swipe distance so a tap does not turn the snake.
  - Desktop: arrow keys or WASD. Mouse or trackpad swipes also work.
  - Boost: hold space on desktop, hold or double-tap on touch. Boost burns length.
  - Buffer one or two queued turns per tick so a fast up-then-left swipe is not lost.
- **Render smoothly, simulate in steps.** The simulation moves in whole tiles per tick. The renderer interpolates between ticks so motion looks fluid, not jerky. Visual-only effects (body ripple, tongue flicks, shadows, particles) must never feed back into the simulation.
- **2D, not 3D.** A tilted 3D version was prototyped and rejected. Do not go 3D.
- **Not decided yet (default assumption for v1):** one shared arena with bots, offline, no server. If the owner wants a classic solo run with a leaderboard instead, the same simulation supports it.

## Design source of truth

Open the HTML files in a browser. They need internet for Google Fonts.

| Need | Where |
| --- | --- |
| Current look (use this) | `design-v2/pages/` |
| Tokens | `design-v2/tokens/tokens-v2.json` and `tokens-v2.css` |
| Mascot expressions, standalone SVG | `design-v2/assets/mascot/` |
| Layouts for menu, game over, wallet and claim states, landing, mobile gameplay | `pages/` (v1) |
| Old tokens, Tailwind preset | `design-tokens/` (v1) |

**Where v2 and v1 disagree, v2 wins.** v2 changed the palette: gold is now `#FFE53D` (v1 `#FFC21A`), red is `#FF4A2E`, and the base is a dark jungle `#0A130E`. The v1 screens (menu, game over, wallet, claim, landing) have not been restyled yet. Keep their layouts and restyle them to v2 as you build them.

Not designed yet, so use your judgment in this style: the v2 landing page, motion boards, the restyled menu and game-over screens. Direction for the landing page is a live snake in the hero that follows the cursor, oversized type collage, overlapping stickers, and a scroll story instead of stacked sections.

The v2 pages were built with hand-written SVG and have not been checked in a browser yet. If something looks off, trust `design-v2/tokens` and this file over the pixels.

## Art direction: arcade sticker

- Flat fills, thick Void outlines (3 to 4px on UI, thicker than the body on snakes), hard offset shadows, **zero blur**. No soft glows, no gradients. Fake glow with 2 or 3 stepped, flat, semi-transparent shapes.
- Texture comes from grain, halftone dots and sticker edges, not from blur.
- Fonts: Bungee for display, buttons and big numbers. Rubik for body text. Space Mono for scores, addresses and labels.
- Buttons: lime fill, Void text, `box-shadow: 0 6px 0 #4FA812`. On press, move down 4px and shorten the shadow.
- On dark panels, hard shadows use Moss Line or Void. On bright fills, use a darker shade of the fill.
- **Color meaning:**
  - Lime is the player and the primary action. Bots never use lime.
  - Gold means $BITE and rewards only. Never decoration.
  - Red means danger only: death, the wall, failed claims.
- Aim for "spectacular": squash and stretch on eating, a small shatter on death, coin-pop on rewards, light screen shake, and the mascot reacting in game over, claim success and empty states (idle, chomp, dead, rich, spooked, snoozing). Respect `prefers-reduced-motion`.

### How a snake is drawn (see `design-v2/pages/v2-snake-craft-skins-food.html`)

Draw in layers, back to front, along the body path:

1. Floor shadow: the body offset down-right, flat dark.
2. Void outline, wider than the body.
3. Shade color, slightly narrower.
4. Base color, narrower again and nudged up-left.
5. Skin pattern as dashed bands or dots on top (diamond bands, stripes, polka dots, wide bands, spots, fine ticks).
6. Highlight dashes along the top edge.
7. Head: rotated to face the direction of travel, bone eyes with Void outline, flicking red tongue.

Every bot gets a skin from `tokens-v2.json`. Skins are also the hook for future cosmetics. The player is always Lime Viper.

Food is little creatures, not dots: berry (+1), beetle (+2), firefly (+5, glows gold with stepped rings), bead (dropped by dead snakes, in that snake's color).

The arena has a tiled dark floor, a red and black hazard border, a stepped vignette and a faint grain. See `v2-gameplay-arena.html`.

## Stack (from the original engineering spec)

- Frontend: Next.js, Phaser (or Canvas/Pixi if simpler for the grid), Wagmi and Viem.
- Backend: NestJS, Prisma, Postgres, Redis.
- Contracts: Foundry.
- The original handoff spec had 6 milestones and is **not in this folder**. Ask the owner to add it as `docs/spec.md`, and follow its milestone order. Until then, build the first milestone below.

### First milestone: playable offline game

No wallet, no chain, no server. Menu, the grid game with bots, boost, game over, and the v2 look with the mascot reactions. Add a minimal local best-score. Structure the code so the simulation is a pure module that the server can reuse later.

## Simulation rules (this is what makes server-verified scores possible)

- Fixed timestep, for example 10 to 20 ticks per second for a grid game. The client and the server use the same step.
- Seeded integer PRNG. No `Math.random()` inside the simulation.
- Integer positions only (tile coordinates). No floating point in game state.
- A run is a seed plus a list of `(tick, direction, boost)` inputs. The server replays it and recomputes the score. Never trust a score sent by the client.
- Keep rendering, audio, particles and animation completely outside the simulation module.

## Token and wallet rules (later milestones, for context)

- The token has **no mint function** reachable by the game server. Rewards come from a distributor contract holding a fixed supply, with per-wallet and daily caps.
- Claims use EIP-712 signatures from a server signer, with a nonce and an expiry, and replay protection.
- Wallet sign-in uses SIWE (EIP-4361).
- Do not hard-code chain ID, RPC or explorer values from memory. Verify them against the official Robinhood Chain docs.

## Copy that must stay

- $BITE is a testnet token with no cash value. It is not an investment and carries no promise of returns, listings or appreciation.
- Do not imply any affiliation with Robinhood.
- BITECLUB never asks for a seed phrase or a private key.

## Placeholders to replace before launch

- Leaderboard names and scores in the designs are sample data.
- "50 $BITE" reward amounts are illustrative. Real tiers and limits are not defined.
- Claim countdowns (like 14:52) are illustrative. Use the real signature expiry.
- Check for existing BITECLUB or $BITE projects before final branding.

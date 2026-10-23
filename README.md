# BITECLUB design kit

Bite. Survive. Dominate.

Brand, landing page, design tokens and app screens for BITECLUB ($BITE, Robinhood Chain Testnet).
Look: arcade sticker, not crypto dashboard. Flat fills, 3px Void outlines, hard offset shadows, zero blur.

## What's in here

```text
biteclub/
├── README.md
├── design-tokens/
│   ├── tokens.json          Source of truth: color, type, space, radius, shadow, motion
│   ├── tokens.css           CSS variables (--bc-*) + .bc-grid helper
│   └── tailwind.preset.ts   Tailwind preset (colors under `bc-*`, fonts, shadows)
├── assets/
│   ├── mascot.svg           Snake mascot, no font dependency
│   └── coin.svg             $BITE coin (mascot cutout), no font dependency
└── pages/                   Standalone HTML, open in a browser (needs internet for Google Fonts)
    ├── logo-and-palette.html
    ├── profile-picture.html
    ├── bite-coin.html
    ├── x-banner.html         1500x500
    ├── announcement-post.html  1080x1080
    ├── landing-page.html     fluid, works down to phone width
    ├── app-main-menu.html
    ├── app-gameplay.html
    ├── app-gameplay-mobile.html  390x844
    ├── app-game-over.html
    ├── app-wallet-states.html    connect, sign in, wrong network
    ├── app-reward-claim-states.html  eligible, pending, claimed, failed
    └── design-tokens.html    visual reference for every token + components
```

## Using the tokens in the Next.js app

1. Fonts, in `app/layout.tsx`, via `next/font/google`: `Bungee`, `Rubik` (400, 500, 700), `Space_Mono` (400, 700).
2. `@import` or paste `design-tokens/tokens.css` into `app/globals.css`.
3. Tailwind: `presets: [biteclub]` in `tailwind.config.ts` (see header comment in `tailwind.preset.ts`).

## Brand rules

- Bite Lime is the player and the primary action. Bots never use lime.
- Coin Gold means $BITE and rewards only. Do not use it for decoration.
- Fang Red means danger: death, arena boundary, failed claims.
- Outlines are always Void. On dark panels, hard shadows use Moss Line; on bright fills, an accent color.
- Display text (Bungee) for headings, buttons and big numbers. Space Mono for scores, addresses and labels.

## Placeholders to replace before launch

- Leaderboard names and scores are sample data (labelled as such on the landing page and menu).
- "50 $BITE" reward amounts are illustrative. Real tiers, per-wallet and daily limits are not defined yet.
- Claim countdowns (e.g. 14:52) are illustrative. Use the real authorization expiry.
- Chain ID, RPC and explorer values are intentionally not shown in the designs. Verify them against official Robinhood Chain docs first.
- Check for existing BITECLUB / $BITE projects before final branding.

## Copy that must stay

$BITE is a testnet token with no cash value. It is not an investment and carries no promise of returns, listings or appreciation.
Do not imply any affiliation with Robinhood.
BITECLUB never asks for a seed phrase or private key.
# biteclub

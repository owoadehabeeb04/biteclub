import tokens from '../../design-v2/tokens/tokens-v2.json';

export const C = tokens.color;
export type SkinName = keyof typeof tokens.skins;
export interface Skin { base: string; shade: string; highlight: string; pattern: string }

// Pattern specs from v2-snake-craft-skins-food.html, as fractions of the outline width.
// width: stroke width, dash: [dash, gap], cap: 'butt' bands or 'round' dots, alpha: pattern opacity.
export interface PatternSpec { width: number; dash: [number, number]; cap: 'butt' | 'round'; alpha: number }
export const PATTERNS: Record<SkinName, PatternSpec> = {
  limeViper: { width: 0.54, dash: [0.107, 0.5], cap: 'butt', alpha: 0.55 },
  gumPython: { width: 0.67, dash: [0.14, 0.57], cap: 'butt', alpha: 0.9 },
  iceCobra: { width: 0.26, dash: [0, 0.57], cap: 'round', alpha: 1 },
  emberMamba: { width: 0.71, dash: [0.29, 0.62], cap: 'butt', alpha: 1 },
  venomAdder: { width: 0.36, dash: [0, 0.81], cap: 'round', alpha: 1 },
  tealRacer: { width: 0.67, dash: [0.07, 0.26], cap: 'butt', alpha: 1 },
};

export const skin = (n: SkinName): Skin => tokens.skins[n];
// Solo mode: the player is always Lime Viper. Bot skins stay in the tokens for later cosmetics.
export const PLAYER_SKIN: SkinName = 'limeViper';

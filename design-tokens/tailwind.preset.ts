import type { Config } from "tailwindcss";

/**
 * BITECLUB Tailwind preset.
 * Usage in tailwind.config.ts:
 *   import biteclub from "./design-tokens/tailwind.preset";
 *   export default { presets: [biteclub], content: [...] } satisfies Config;
 */
const preset = {
  content: [],
  theme: {
    extend: {
      colors: {
        bc: {
          ink: "#0D130E",
          pit: "#152019",
          moss: "#1F2E24",
          lime: "#8CFF2E",
          "lime-deep": "#5BC014",
          bone: "#F3EFDC",
          gold: "#FFC21A", // $BITE and rewards only
          "gold-deep": "#C98F00",
          red: "#FF4A2E",
          "red-deep": "#A82E18",
          void: "#050805",
          muted: "#A9B5A3",
          bot: {
            pink: "#FF3D8B",
            cyan: "#2ED8FF",
            orange: "#FF8A1F",
            violet: "#9B5CFF",
            teal: "#17D6A3",
            yellow: "#FFE53D",
          },
        },
      },
      fontFamily: {
        display: ["Bungee", "Arial Black", "sans-serif"],
        body: ["Rubik", "Arial", "sans-serif"],
        mono: ["Space Mono", "monospace"],
      },
      fontSize: {
        "display-xl": ["96px", { lineHeight: "1" }],
        "display-l": ["56px", { lineHeight: "1.05" }],
        heading: ["32px", { lineHeight: "1.1" }],
        "body-l": ["20px", { lineHeight: "1.5" }],
        label: ["12px", { lineHeight: "1.3", letterSpacing: "1px" }],
      },
      borderRadius: {
        "bc-sm": "6px",
        "bc-md": "10px",
        "bc-lg": "16px",
        "bc-xl": "20px",
      },
      borderWidth: {
        bc: "3px",
        "bc-card": "4px",
      },
      boxShadow: {
        "bc-sm": "4px 4px 0 #1F2E24",
        "bc-md": "6px 6px 0 #1F2E24",
        "bc-lg": "8px 8px 0 #1F2E24",
        "bc-lime-sm": "4px 4px 0 #8CFF2E",
        "bc-lime-md": "6px 6px 0 #8CFF2E",
        "bc-press-lime": "0 6px 0 #5BC014",
        "bc-press-gold": "0 6px 0 #C98F00",
        "bc-press-red": "0 6px 0 #A82E18",
      },
      transitionTimingFunction: {
        "coin-pop": "cubic-bezier(0.3, 1.6, 0.5, 1)",
      },
    },
  },
} satisfies Config;

export default preset;

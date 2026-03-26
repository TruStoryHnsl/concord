import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0c0e11",
          "container-low": "#111417",
          container: "#171a1d",
          "container-high": "#1d2024",
          "container-highest": "#23262a",
          variant: "#23262a",
          bright: "#292c31",
          dim: "#0c0e11",
          "container-lowest": "#000000",
          tint: "#a4a5ff",
        },
        "on-surface": {
          DEFAULT: "#f9f9fd",
          variant: "#aaabaf",
        },
        "on-background": "#f9f9fd",
        background: "#0c0e11",
        primary: {
          DEFAULT: "#a4a5ff",
          dim: "#5e5eff",
          container: "#9496ff",
          fixed: "#9496ff",
          "fixed-dim": "#8486ff",
        },
        "on-primary": {
          DEFAULT: "#1300a3",
          container: "#0c0081",
          fixed: "#000000",
          "fixed-variant": "#11009c",
        },
        "inverse-primary": "#4644ea",
        secondary: {
          DEFAULT: "#afefdd",
          dim: "#a1e1cf",
          container: "#0b5345",
          fixed: "#afefdd",
          "fixed-dim": "#a1e1cf",
        },
        "on-secondary": {
          DEFAULT: "#195c4e",
          container: "#a1e1cf",
          fixed: "#00483c",
          "fixed-variant": "#266658",
        },
        tertiary: {
          DEFAULT: "#e7fff3",
          dim: "#7be2bd",
          container: "#98ffd9",
          fixed: "#98ffd9",
          "fixed-dim": "#89f0cb",
        },
        "on-tertiary": {
          DEFAULT: "#006c52",
          container: "#00634b",
          fixed: "#004f3b",
          "fixed-variant": "#006e54",
        },
        error: {
          DEFAULT: "#ff716c",
          dim: "#d7383b",
          container: "#9f0519",
        },
        "on-error": {
          DEFAULT: "#490006",
          container: "#ffa8a3",
        },
        outline: {
          DEFAULT: "#747579",
          variant: "#46484b",
        },
        "inverse-surface": "#f9f9fd",
        "inverse-on-surface": "#535559",
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body: ["Manrope", "sans-serif"],
        label: ["Manrope", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px",
      },
    },
  },
  plugins: [],
} satisfies Config;

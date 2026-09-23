import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sumi: {
          50: "#f7f6f3",
          100: "#ecebe5",
          200: "#d6d3c5",
          300: "#b8b39e",
          400: "#9a9378",
          500: "#7a745c",
          600: "#5d5846",
          700: "#3f3b2f",
          800: "#26241c",
          900: "#16150f",
        },
        shu: {
          50: "#fdf2f2",
          100: "#fbe1e1",
          200: "#f7c2c2",
          300: "#f09595",
          400: "#e85f5f",
          500: "#d63a3a",
          600: "#b32525",
          700: "#8a1a1a",
          800: "#5e1212",
          900: "#3d0c0c",
        },
        kinari: "#f7f4ec",
        take: {
          50: "#f1f7ed",
          100: "#dfe9d4",
          200: "#bcd1a4",
          300: "#95b574",
          400: "#759a52",
          500: "#587d3c",
          600: "#43612f",
          700: "#324923",
          800: "#1f2e16",
        },
        ai: {
          50: "#eef6fb",
          100: "#d6e9f4",
          200: "#a8cee4",
          300: "#75aed1",
          400: "#4689b8",
          500: "#2f6f9c",
          600: "#23577b",
          700: "#1a425c",
          800: "#102b3d",
        },
      },
      fontFamily: {
        jp: ['"Noto Sans JP"', "system-ui", "sans-serif"],
        serif: ['"Noto Serif JP"', "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      boxShadow: {
        jp: "0 1px 0 rgba(0,0,0,0.04), 0 4px 16px -6px rgba(20,20,10,0.18)",
        "jp-lg":
          "0 4px 0 rgba(0,0,0,0.04), 0 24px 40px -16px rgba(20,20,10,0.22)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scroll-x": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "pulse-ring":
          "pulse-ring 1.6s cubic-bezier(0.215, 0.61, 0.355, 1) infinite",
        "fade-in": "fade-in 0.25s ease-out",
        "scroll-x": "scroll-x 40s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;

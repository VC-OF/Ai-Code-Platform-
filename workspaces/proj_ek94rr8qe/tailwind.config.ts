import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        jp: [
          "'Noto Sans JP'",
          "'Hiragino Sans'",
          "'Yu Gothic'",
          "Meiryo",
          "sans-serif",
        ],
      },
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#eeeef0",
          200: "#d6d6db",
          300: "#b3b3bd",
          500: "#6b6b78",
          700: "#3a3a44",
          900: "#15151b",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

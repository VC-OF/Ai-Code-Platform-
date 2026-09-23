/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6ff",
          200: "#bdd1ff",
          300: "#90b1ff",
          400: "#5d85ff",
          500: "#3a60f7",
          600: "#2745e0",
          700: "#1f36b6",
          800: "#1d3090",
          900: "#1c2d72",
        },
      },
    },
  },
  plugins: [],
};

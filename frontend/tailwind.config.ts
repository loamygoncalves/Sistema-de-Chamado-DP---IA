import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta oficial Beep Saúde — verde principal #00AFAA.
        brand: {
          50: "#e0f5f4",
          100: "#b8e9e6",
          200: "#8cdbd7",
          300: "#5fccc6",
          400: "#33bdb5",
          500: "#00afaa",
          600: "#00968f",
          700: "#007b75",
          800: "#00625d",
          900: "#004a47",
        },
        // Laranja Beep — único acento além do verde, usado com moderação.
        accent: {
          50: "#fff1d9",
          100: "#ffe0ad",
          500: "#fba600",
          600: "#d98d00",
          700: "#7a4d00",
        },
      },
      fontFamily: {
        sans: ["var(--font-raleway)", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

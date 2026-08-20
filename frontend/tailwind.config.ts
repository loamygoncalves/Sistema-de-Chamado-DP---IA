import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#1466ff",
          600: "#0f52d6",
          700: "#0c40a8",
          900: "#0a2a6e",
        },
      },
    },
  },
  plugins: [],
};

export default config;

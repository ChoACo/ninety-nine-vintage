import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      desktop: "1200px",
      wide: "1440px",
    },
    extend: {
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "Pretendard Variable",
          "Pretendard",
          "Noto Sans KR",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
      },
      colors: {
        ink: "rgb(var(--theme-ink) / <alpha-value>)",
        paper: "rgb(var(--theme-paper) / <alpha-value>)",
        line: "rgb(var(--theme-line) / <alpha-value>)",
        muted: "rgb(var(--theme-muted) / <alpha-value>)",
        surface: "rgb(var(--theme-surface) / <alpha-value>)",
        inverse: "rgb(var(--theme-inverse) / <alpha-value>)",
      },
      spacing: {
        18: "4.5rem",
        22: "5.5rem",
        26: "6.5rem",
        30: "7.5rem",
        34: "8.5rem",
        38: "9.5rem",
        42: "10.5rem",
        46: "11.5rem",
        52: "13rem",
        60: "15rem",
      },
      maxWidth: {
        desktop: "1200px",
        wide: "1440px",
      },
      gridTemplateColumns: {
        "products-4": "repeat(4, minmax(0, 1fr))",
        "products-5": "repeat(5, minmax(0, 1fr))",
      },
      boxShadow: {
        card: "var(--theme-card-shadow)",
      },
    },
  },
};

export default config;

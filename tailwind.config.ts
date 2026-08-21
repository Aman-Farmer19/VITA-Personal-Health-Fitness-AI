import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vita: {
          cyan:    '#00E5FF',
          pink:    '#FF2D9A',
          violet:  '#7C3AED',
          green:   '#00FF88',
          gold:    '#FFD700',
          orange:  '#FF8C00',
          bg:      '#050510',
          panel:   '#1a0a2e',
        },
      },
      fontFamily: {
        mono: ['"Space Mono"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

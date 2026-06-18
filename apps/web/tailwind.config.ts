import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Semantic palette from canvas_ux_addendum (locked).
        // Investigators don't free-pick colors; we ship a curated palette.
        taint: { 100: '#fee2e2', 500: '#ef4444', 700: '#b91c1c', 900: '#7f1d1d' }, // red — sanctions, criminal
        elevated: { 100: '#ffedd5', 500: '#f97316', 700: '#c2410c' }, // orange — risk, unattributed
        caution: { 100: '#fef9c3', 500: '#eab308', 700: '#a16207' }, // yellow — soft attribution
        clean: { 100: '#dcfce7', 500: '#22c55e', 700: '#15803d' }, // green — attributed legit
        markup: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' }, // blue — investigator markup
        privacy: { 100: '#f3e8ff', 500: '#a855f7', 700: '#7e22ce' }, // purple — privacy chains, mixers
        context: { 100: '#f3f4f6', 500: '#6b7280', 700: '#374151' }, // gray — reference only
      },
    },
  },
  plugins: [],
};

export default config;

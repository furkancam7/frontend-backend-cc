/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'tactical-bg': '#000000',
        'tactical-panel': '#0A0A0A',
        'tactical-border': '#1A1A1A',
        'tactical-text': '#E6F0FF',
        'tactical-text-secondary': '#8CA3B8',
        'tactical-cyan': '#00E0FF',
        'tactical-teal': '#14B8A6',
        'tactical-dock': '#000000',
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

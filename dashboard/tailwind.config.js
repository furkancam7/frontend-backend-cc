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
        'tactical-cyan': '#FC581C',
        'tactical-teal': '#10302C',
        'tactical-dock': '#000000',
        cyan: {
          50: '#FFF3EB',
          100: '#FFE2D2',
          200: '#FFC5A8',
          300: '#FFA87F',
          400: '#FF8A55',
          500: '#FC581C',
          600: '#D24817',
          700: '#10302C',
          800: '#0D2824',
          900: '#0A211D',
          950: '#071815',
        },
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

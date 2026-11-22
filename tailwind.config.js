/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        field: {
          950: '#070b14',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          500: '#0ea5e9',
          400: '#38bdf8',
        },
      },
    },
  },
  plugins: [],
};

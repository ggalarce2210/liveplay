/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Paleta "LIVEPLAY": verde césped + negro premium + acento ámbar (estilo
        // streaming deportivo — Netflix + apps de gestión deportiva, ver §18).
        pitch: {
          950: '#04120a',
          900: '#071d10',
          800: '#0d2e19',
          700: '#144024',
          600: '#1c5a33',
          500: '#237a41',
          400: '#2f9a52',
        },
        ink: {
          950: '#06070a',
          900: '#0b0d12',
          800: '#12151c',
          700: '#1b1f29',
          600: '#262c38',
          500: '#39414f',
          400: '#5b6474',
          300: '#8890a0',
          200: '#b7bec9',
          100: '#e4e7ec',
        },
        amber: {
          400: '#ffb020',
          500: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(47,154,82,0.35), 0 8px 30px -8px rgba(47,154,82,0.45)',
      },
    },
  },
  plugins: [],
};

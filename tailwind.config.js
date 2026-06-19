/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Peerlytics brand
        brand: {
          DEFAULT: '#1D9E75',
          dark: '#0F6E56',
          50: '#e8f5f0',
          100: '#c7e8db',
          200: '#9fd9c2',
          300: '#6cc6a3',
          400: '#3fb289',
          500: '#1D9E75',
          600: '#178463',
          700: '#0F6E56',
          800: '#0a5544',
          900: '#053628',
        },
        // Functional palette mirroring existing inline colors
        info: '#4facfe',
        warn: '#ffc107',
        danger: '#e74c3c',
        success: '#1D9E75',
        // Dark surface tokens — black/grey to match the logo
        ink: {
          50: '#f7f8fc',
          100: '#ededed',
          400: '#9a9a9a',
          700: '#2e2e2e',
          800: '#1c1c1c',
          900: '#141414',
          950: '#0d0d0d',
        },
      },
      boxShadow: {
        soft: '0 6px 30px rgba(0,0,0,0.10)',
        panel: '0 20px 60px rgba(0,0,0,0.35)',
        focus: '0 0 0 3px rgba(29,158,117,0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #1D9E75 0%, #0F6E56 100%)',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

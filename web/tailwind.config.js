/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        industrial: {
          bg: '#0F172A',      // Slate 900
          card: '#1E293B',    // Slate 800
          border: '#334155',  // Slate 700
          green: '#10B981',   // Emerald 500
          blue: '#38BDF8',    // Sky 400
          red: '#D32F2F',     // Industrial Red
          dark: '#020617',    // Slate 950
        }
      }
    },
  },
  plugins: [],
}

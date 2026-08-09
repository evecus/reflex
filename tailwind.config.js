/** @type {import('tailwindcss').Config} */

// 使用 CSS 变量驱动配色，便于在亮/暗主题之间切换。
// 变量在 globals.css 的 :root / .light 块中定义。
function withVar(name) {
  return `rgb(var(--c-${name}) / <alpha-value>)`;
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '.dark'],
  theme: {
    extend: {
      colors: {
        // Aurora Glass 配色（CSS 变量驱动，亮/暗主题切换）
        ink: {
          950: withVar('ink-950'),
          900: withVar('ink-900'),
          800: withVar('ink-800'),
          700: withVar('ink-700'),
          600: withVar('ink-600'),
          500: withVar('ink-500'),
        },
        line: withVar('line'),
        fg: {
          DEFAULT: withVar('fg'),
          muted: withVar('fg-muted'),
          subtle: withVar('fg-subtle'),
        },
        accent: {
          DEFAULT: withVar('accent'),
          2: withVar('accent-2'),
          glow: withVar('accent-glow'),
          dim: withVar('accent-dim'),
        },
        warn: withVar('warn'),
        danger: withVar('danger'),
        ok: withVar('ok'),
      },
      fontFamily: {
        display: ['"Space Mono"', 'ui-monospace', 'monospace'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
        xl: '14px',
        '2xl': '18px',
      },
      boxShadow: {
        glow: '0 0 32px -4px rgb(var(--c-accent) / 0.45)',
        'glow-sm': '0 0 14px -2px rgb(var(--c-accent) / 0.4)',
        'glow-lg': '0 0 56px -8px rgb(var(--c-accent) / 0.35)',
        card: '0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 12px 40px -16px #000000',
        'inner-glass': 'inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(120deg, rgb(var(--c-accent)), rgb(var(--c-accent-2)))',
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'gradient-x': 'gradient-x 8s ease infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 14px -2px rgb(var(--c-accent) / 0.4)' },
          '50%': { boxShadow: '0 0 28px 0px rgb(var(--c-accent) / 0.65)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};

import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type FontFamily = 'sans' | 'mono' | 'display';

interface ThemeState {
  theme: Theme;
  font: FontFamily;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setFont: (f: FontFamily) => void;
}

const THEME_KEY = 'reflex.theme';
const FONT_KEY = 'reflex.font';

/**
 * 从 localStorage 恢复偏好，默认 dark + sans。
 * 在模块加载时立即应用，避免首屏闪烁（FOUC）。
 */
function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function readFont(): FontFamily {
  const stored = localStorage.getItem(FONT_KEY);
  return stored === 'mono' || stored === 'display' ? stored : 'sans';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  }
}

function applyFont(font: FontFamily) {
  document.documentElement.dataset.font = font;
}

const initialTheme = readTheme();
const initialFont = readFont();
applyTheme(initialTheme);
applyFont(initialFont);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  font: initialFont,
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    set({ theme: next });
  },
  setFont: (font) => {
    localStorage.setItem(FONT_KEY, font);
    applyFont(font);
    set({ font });
  },
}));

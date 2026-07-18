"use client";

import { useSyncExternalStore } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ninety-nine-theme";
const LEGACY_THEME_STORAGE_KEY = "damine-theme";

const themeListeners = new Set<() => void>();

function normalizeTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function getThemeSnapshot(): Theme {
  return normalizeTheme(document.documentElement.dataset.theme);
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function notifyThemeListeners() {
  themeListeners.forEach((listener) => listener());
}

function subscribeToTheme(listener: () => void) {
  themeListeners.add(listener);

  const syncTheme = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;

    applyTheme(normalizeTheme(event.newValue));
    notifyThemeListeners();
  };

  window.addEventListener("storage", syncTheme);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", syncTheme);
  };
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const selectTheme = (nextTheme: Theme) => {
    applyTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // The selection still applies for this session when storage is unavailable.
    }

    notifyThemeListeners();
  };

  return (
    <div className={styles.toggle} role="group" aria-label="화면 테마 선택">
      <button
        type="button"
        className={styles.option}
        data-active={theme === "light"}
        aria-pressed={theme === "light"}
        onClick={() => selectTheme("light")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className={styles.label}>라이트</span>
      </button>
      <button
        type="button"
        className={styles.option}
        data-active={theme === "dark"}
        aria-pressed={theme === "dark"}
        onClick={() => selectTheme("dark")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
          <path d="M20 15.2A8.3 8.3 0 0 1 8.8 4 8.3 8.3 0 1 0 20 15.2Z" />
        </svg>
        <span className={styles.label}>다크</span>
      </button>
    </div>
  );
}

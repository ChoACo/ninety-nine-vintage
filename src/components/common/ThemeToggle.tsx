"use client";

import { useSyncExternalStore } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "damine-theme";

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
        라이트
      </button>
      <button
        type="button"
        className={styles.option}
        data-active={theme === "dark"}
        aria-pressed={theme === "dark"}
        onClick={() => selectTheme("dark")}
      >
        다크
      </button>
    </div>
  );
}

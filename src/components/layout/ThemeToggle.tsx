"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ColorTheme = "light" | "dark";

const STORAGE_KEY = "ninety-nine:color-theme";
const THEME_EVENT = "ninety-nine:theme-change";
const THEME_COLORS: Record<ColorTheme, string> = {
  light: "#fbfaf7",
  dark: "#15181c",
};

function currentTheme(): ColorTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function systemTheme(): ColorTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ColorTheme, persist: boolean) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }
  window.dispatchEvent(new CustomEvent<ColorTheme>(THEME_EVENT, { detail: theme }));
}

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function ThemeToggle({ className = "", showLabel = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<ColorTheme>("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncFromDocument = () => setTheme(currentTheme());
    const syncFromSystem = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch {}
      if (saved !== "light" && saved !== "dark") applyTheme(systemTheme(), false);
    };
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      applyTheme(event.newValue === "light" || event.newValue === "dark" ? event.newValue : systemTheme(), false);
    };

    syncFromDocument();
    window.addEventListener(THEME_EVENT, syncFromDocument);
    window.addEventListener("storage", syncFromStorage);
    media.addEventListener("change", syncFromSystem);
    return () => {
      window.removeEventListener(THEME_EVENT, syncFromDocument);
      window.removeEventListener("storage", syncFromStorage);
      media.removeEventListener("change", syncFromSystem);
    };
  }, []);

  const dark = theme === "dark";
  const label = dark ? "라이트 모드로 전환" : "다크 모드로 전환";

  return (
    <button
      aria-label={label}
      aria-pressed={dark}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-bold transition-all duration-300 hover:-translate-y-0.5 hover:border-ink active:scale-95 ${className}`}
      onClick={() => applyTheme(dark ? "light" : "dark", true)}
      title={label}
      type="button"
    >
      {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
      {showLabel && <span>{dark ? "라이트 모드" : "다크 모드"}</span>}
    </button>
  );
}

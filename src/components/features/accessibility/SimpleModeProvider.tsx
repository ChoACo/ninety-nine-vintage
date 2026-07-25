"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export const SIMPLE_MODE_STORAGE_KEY = "ninety-nine:simple-mode";

interface SimpleModeState {
  enabled: boolean;
  error: string | null;
  hydrated: boolean;
  saving: boolean;
  setEnabled(enabled: boolean): Promise<void>;
  toggle(): Promise<void>;
}

interface ExperiencePreferencesResponse {
  preferences?: {
    simpleModeEnabled?: boolean;
  };
}

const SimpleModeContext = createContext<SimpleModeState | null>(null);

function writeDevicePreference(enabled: boolean) {
  document.documentElement.dataset.simpleMode = enabled ? "on" : "off";
  try {
    localStorage.setItem(SIMPLE_MODE_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // The current page still keeps the selected presentation.
  }
}

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;
  return payload?.message || "간편모드 설정을 저장하지 못했습니다.";
}

export function SimpleModeProvider({ children }: { children: ReactNode }) {
  const { session } = useSupabaseSession();
  const accessToken = session?.access_token ?? null;
  const userId = session?.user.id ?? null;
  const localRevision = useRef(0);
  const [enabled, setEnabledState] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let stored = document.documentElement.dataset.simpleMode === "on";
    try {
      stored = localStorage.getItem(SIMPLE_MODE_STORAGE_KEY) === "on";
    } catch {
      // Keep the early document preference when storage is unavailable.
    }
    writeDevicePreference(stored);
    queueMicrotask(() => {
      if (!active) return;
      setEnabledState(stored);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!accessToken || !userId || !hydrated) return;
    let active = true;
    const controller = new AbortController();
    const revision = localRevision.current;
    void fetch("/api/account/experience", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return (await response.json()) as ExperiencePreferencesResponse;
      })
      .then((payload) => {
        if (
          !active ||
          revision !== localRevision.current ||
          typeof payload.preferences?.simpleModeEnabled !== "boolean"
        ) {
          return;
        }
        setEnabledState(payload.preferences.simpleModeEnabled);
        writeDevicePreference(payload.preferences.simpleModeEnabled);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "간편모드 설정을 불러오지 못했습니다.",
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, hydrated, userId]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean) => {
      localRevision.current += 1;
      setEnabledState(nextEnabled);
      writeDevicePreference(nextEnabled);
      setError(null);
      if (!accessToken) return;
      setSaving(true);
      try {
        const response = await fetch("/api/account/experience", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ simpleModeEnabled: nextEnabled }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "간편모드 설정을 저장하지 못했습니다.",
        );
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [accessToken],
  );

  const toggle = useCallback(
    () => setEnabled(!enabled),
    [enabled, setEnabled],
  );

  const value = useMemo<SimpleModeState>(
    () => ({
      enabled,
      error,
      hydrated,
      saving,
      setEnabled,
      toggle,
    }),
    [enabled, error, hydrated, saving, setEnabled, toggle],
  );

  return (
    <SimpleModeContext.Provider value={value}>
      {children}
    </SimpleModeContext.Provider>
  );
}

export function useSimpleMode() {
  const value = useContext(SimpleModeContext);
  if (!value) {
    throw new Error("useSimpleMode must be used inside SimpleModeProvider");
  }
  return value;
}

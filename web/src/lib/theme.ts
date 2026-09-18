import { useEffect, useState, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";

function stored(): ThemeMode {
  try {
    const v = localStorage.getItem("fp-theme");
    if (v === "light" || v === "dark") return v;
  } catch {
    // storage unavailable: fall through to system
  }
  return "system";
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(stored);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mode === "dark" || (mode === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
  const setMode = (m: ThemeMode) => {
    try {
      if (m === "system") localStorage.removeItem("fp-theme");
      else localStorage.setItem("fp-theme", m);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
    setModeState(m);
  };
  return [mode, setMode] as const;
}

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  return () => {
    listeners.delete(cb);
  };
}

const isDark = () => document.documentElement.classList.contains("dark");

/** True while the page renders in dark mode; charts re-create on change. */
export function useIsDark() {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

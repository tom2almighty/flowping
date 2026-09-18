import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Site } from "@/types";

const SiteContext = createContext<{ site: Site | undefined; reload: () => Promise<void> }>({
  site: undefined,
  reload: async () => {
    // replaced by SiteProvider
  },
});

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<Site | undefined>();
  const reload = useCallback(async () => {
    try {
      setSite(await api.get<Site>("/api/v1/site"));
    } catch {
      // keep whatever we had; the page shows its own errors
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const name = site?.name;
  const theme = site?.theme;

  useEffect(() => {
    if (name) document.title = name;
  }, [name]);

  // Market themes are plain stylesheets: one link tag, nothing executable.
  useEffect(() => {
    const id = "fp-theme-css";
    document.getElementById(id)?.remove();
    if (theme) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `/themes/${encodeURIComponent(theme)}/theme.css`;
      document.head.appendChild(link);
    }
  }, [theme]);

  return <SiteContext.Provider value={{ site, reload }}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}

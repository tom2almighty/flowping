import { useCallback, useEffect, useRef, useState } from "react";

interface PollState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Fetches on mount and every intervalMs while the tab is visible. The
 * previous data stays on screen during refetches so charts never flash.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [state, setState] = useState<PollState<T>>({ data: undefined, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const data = await fetcherRef.current();
        if (alive) setState({ data, error: null, loading: false });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e as Error, loading: false }));
      }
      if (alive && intervalMs > 0)
        timer = setTimeout(run, document.hidden ? intervalMs * 4 : intervalMs);
    };
    setState((s) => ({ ...s, loading: true }));
    run();
    const onVisible = () => {
      if (!document.hidden && alive) {
        clearTimeout(timer);
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, tick, ...deps]);

  return { ...state, reload };
}

/** Wall clock that re-renders every everyMs. */
export function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

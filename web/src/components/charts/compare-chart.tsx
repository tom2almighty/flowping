import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { fmtDateTime, fmtMs, fmtTick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PingSeries } from "@/types";
import { axisBase, tooltipPlugin, ttRow, ttTitle, useUPlot } from "./uplot-base";

/**
 * Overlay view: one median line per probe, no smoke bands. The bands cannot be
 * stacked without turning into mud, so this mode exists for reading trends side
 * by side; the smoke view stays the default for looking at one probe.
 *
 * The palette is the documented five-hue categorical order, assigned by
 * position and never cycled, which is why the callers cap the series list.
 */

export const COMPARE_MAX = 5;

export interface CompareItem {
  key: string;
  label: string;
  data: PingSeries | undefined;
}

export function compareItems<T>(
  entities: T[],
  key: (t: T) => string,
  label: (t: T) => string,
  data: (t: T) => PingSeries | undefined,
): { items: CompareItem[]; truncated: number } {
  const items = entities.map((e) => ({ key: key(e), label: label(e), data: data(e) }));
  return { items: items.slice(0, COMPARE_MAX), truncated: Math.max(0, items.length - COMPARE_MAX) };
}

export function itemColor(i: number): string {
  return `var(--chart-${i + 1})`;
}

/** Share of probes lost across the whole window, per item. */
export function itemLoss(data: PingSeries | undefined): number {
  let sent = 0;
  let recv = 0;
  if (data) {
    for (let i = 0; i < data.ts.length; i++) {
      sent += data.sent[i];
      recv += data.recv[i];
    }
  }
  return sent > 0 ? (100 * (sent - recv)) / sent : 0;
}

interface Aligned {
  data: uPlot.AlignedData;
  rowAt: Int32Array[];
}

function align(items: CompareItem[], from: number, to: number, step: number): Aligned {
  const n = Math.max(1, Math.floor((to - from) / step) + 1);
  const ts: number[] = new Array(n);
  for (let i = 0; i < n; i++) ts[i] = from + i * step;
  const cols: (number | null)[][] = [ts];
  const rowAt: Int32Array[] = [];
  for (const it of items) {
    const col: (number | null)[] = new Array(n).fill(null);
    const map = new Int32Array(n).fill(-1);
    const s = it.data;
    if (s) {
      for (let k = 0; k < s.ts.length; k++) {
        const i = Math.round((s.ts[k] - from) / step);
        if (i < 0 || i >= n) continue;
        col[i] = s.p50[k];
        map[i] = k;
      }
    }
    cols.push(col);
    rowAt.push(map);
  }
  return { data: cols as unknown as uPlot.AlignedData, rowAt };
}

export function CompareChart({
  items,
  from,
  to,
  step,
  height = 220,
  syncKey = "fp-latency",
  hint,
}: {
  items: CompareItem[];
  from: number;
  to: number;
  step: number;
  height?: number;
  syncKey?: string;
  hint?: ReactNode;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const { data, rowAt } = useMemo(() => align(items, from, to, step), [items, from, to, step]);
  const span = to - from;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rowAtRef = useRef(rowAt);
  rowAtRef.current = rowAt;
  const plot = useRef<uPlot | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // The plot is rebuilt on a theme flip or a resize of the series list, so the
  // legend's hidden set is reapplied on every build.
  const onReady = useCallback((u: uPlot | null) => {
    plot.current = u;
    if (!u) return;
    for (const [i, it] of itemsRef.current.entries()) {
      u.setSeries(i + 1, { show: !hiddenRef.current.has(it.key) });
    }
  }, []);

  const toggle = (key: string) => {
    const show = hidden.has(key);
    const next = new Set(hidden);
    if (show) next.delete(key);
    else next.add(key);
    setHidden(next);
    const i = items.findIndex((it) => it.key === key);
    if (i >= 0) plot.current?.setSeries(i + 1, { show });
  };

  const ref = useUPlot(
    (width, css) => ({
      width,
      height,
      cursor: {
        sync: { key: syncKey },
        points: { show: false },
        drag: { x: false, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { range: (_u, _min, max): [number, number] => [0, max > 0 ? max * 1.06 : 10] },
      },
      axes: [
        {
          ...axisBase(css),
          space: 70,
          values: (_u, splits) => splits.map((v) => fmtTick(v, span)),
        },
        {
          ...axisBase(css),
          size: 46,
          values: (_u, splits) => splits.map((v) => (v >= 1000 ? `${v / 1000}s` : `${v}`)),
        },
      ],
      series: [
        {},
        ...items.map<uPlot.Series>((_, i) => ({
          stroke: css(`--chart-${i + 1}`),
          width: 2,
          spanGaps: false,
          points: { show: false },
        })),
      ],
      plugins: [
        tooltipPlugin((u, idx, box) => {
          const list = itemsRef.current;
          const rows = rowAtRef.current;
          const shown: { i: number; text: string }[] = [];
          for (let i = 0; i < list.length; i++) {
            if (hiddenRef.current.has(list[i].key)) continue;
            const v = u.data[i + 1][idx];
            if (v != null) {
              shown.push({ i, text: fmtMs(v) });
              continue;
            }
            const k = idx < rows[i].length ? rows[i][idx] : -1;
            if (k >= 0 && list[i].data?.sent[k]) shown.push({ i, text: "丢失" });
          }
          if (shown.length === 0) return;
          ttTitle(box, fmtDateTime(u.data[0][idx]));
          for (const s of shown) ttRow(box, list[s.i].label, s.text, css(`--chart-${s.i + 1}`));
        }),
      ],
    }),
    data,
    `${height}:${span}:${syncKey}:${items.length}`,
    onReady,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {items.map((it, i) => {
            const off = hidden.has(it.key);
            return (
              <li key={it.key}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(it.key)}
                  title={off ? `显示 ${it.label}` : `隐藏 ${it.label}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 transition-opacity hover:border-foreground/30",
                    off && "opacity-45",
                  )}
                >
                  <span
                    className="inline-block h-0.5 w-3.5 shrink-0 rounded-full"
                    style={{ background: itemColor(i) }}
                    aria-hidden
                  />
                  <span>{it.label}</span>
                  <span className="text-muted-foreground tnum">
                    {itemLoss(it.data).toFixed(1)}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div ref={ref} className="w-full" style={{ height }} />
    </div>
  );
}

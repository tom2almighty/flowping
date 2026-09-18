import { useMemo, useRef } from "react";
import type uPlot from "uplot";
import { fmtDateTime, fmtMs, fmtTick, lossBucket } from "@/lib/format";
import type { PingSeries } from "@/types";
import { axisBase, type CssVar, tooltipPlugin, ttRow, ttTitle, useUPlot } from "./uplot-base";

/**
 * A smokeping-style plot: the spread between min and max is the smoke, the
 * quartile band is darker smoke, and the median line changes color with the
 * packet loss of each probe cycle. Cycles that lost every probe show as
 * points on the baseline; cycles that never reached the hub show as gaps.
 */

const LOSS_LABELS = ["0% 丢包", "≤5% 丢包", "≤20% 丢包", "≤50% 丢包", ">50% 丢包"];
const LOSS_VARS = ["--chart-1", "--warn", "--serious", "--crit", "--loss-heavy"];

export function lossColors(css: CssVar) {
  return LOSS_VARS.map((v) => css(v));
}

/** Indices whose neighbours are both empty; a line cannot show those. */
function isolatedPoints(u: uPlot, sidx: number): number[] {
  const ys = u.data[sidx];
  const out: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] == null) continue;
    if ((i === 0 || ys[i - 1] == null) && (i === ys.length - 1 || ys[i + 1] == null)) out.push(i);
  }
  return out;
}

export function LossLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LOSS_LABELS.map((l, i) => (
        <li key={l} className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ background: `var(${LOSS_VARS[i]})` }}
            aria-hidden
          />
          {l}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 rounded-full bg-crit" aria-hidden />
        全部丢失
      </li>
    </ul>
  );
}

/**
 * Column layout: ts, max, min, p75, p25, median×5 (by loss bucket), total-loss
 * marker. rowAt maps each slot back to the series row that filled it.
 */
function toAligned(s: PingSeries | undefined, from: number, to: number, step: number) {
  const n = Math.max(1, Math.floor((to - from) / step) + 1);
  const cols: (number | null)[][] = Array.from({ length: 11 }, () => new Array(n).fill(null));
  const rowAt = new Int32Array(n).fill(-1);
  const ts = cols[0];
  for (let i = 0; i < n; i++) ts[i] = from + i * step;
  if (!s) return { data: cols as unknown as uPlot.AlignedData, rowAt };
  const bucketAt = new Int8Array(n).fill(-1);
  for (let k = 0; k < s.ts.length; k++) {
    const i = Math.round((s.ts[k] - from) / step);
    if (i < 0 || i >= n) continue;
    rowAt[i] = k;
    cols[1][i] = s.max[k];
    cols[2][i] = s.min[k];
    cols[3][i] = s.p75[k];
    cols[4][i] = s.p25[k];
    const sent = s.sent[k];
    const loss = sent > 0 ? (100 * (sent - s.recv[k])) / sent : 0;
    const p50 = s.p50[k];
    if (p50 != null) {
      const b = lossBucket(loss);
      bucketAt[i] = b;
      cols[5 + b][i] = p50;
    } else if (sent > 0) {
      cols[10][i] = 0;
    }
  }
  // carry each colored segment one point past its bucket so the line has no gaps
  for (let i = 1; i < n; i++) {
    const prev = bucketAt[i - 1];
    const cur = bucketAt[i];
    if (prev >= 0 && cur >= 0 && prev !== cur) cols[5 + prev][i] = cols[5 + cur][i];
  }
  return { data: cols as unknown as uPlot.AlignedData, rowAt };
}

export function SmokeChart({
  series,
  from,
  to,
  step,
  height = 190,
  syncKey = "fp-latency",
}: {
  series: PingSeries | undefined;
  from: number;
  to: number;
  step: number;
  height?: number;
  syncKey?: string;
}) {
  const { data, rowAt } = useMemo(
    () => toAligned(series, from, to, step),
    [series, from, to, step],
  );
  const span = to - from;
  // the tooltip closure is created once per chart; read live values through refs
  const seriesRef = useRef(series);
  seriesRef.current = series;
  const rowAtRef = useRef(rowAt);
  rowAtRef.current = rowAt;

  const ref = useUPlot(
    (width, css) => {
      const colors = lossColors(css);
      const hidden: uPlot.Series = { stroke: "rgba(0,0,0,0)", width: 1, points: { show: false } };
      const median = (i: number): uPlot.Series => ({
        stroke: colors[i],
        width: 2,
        spanGaps: false,
        points: {
          show: true,
          size: 5,
          width: 0,
          fill: colors[i],
          stroke: colors[i],
          filter: (u, sidx) => isolatedPoints(u, sidx),
        },
      });
      return {
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
          hidden,
          hidden,
          hidden,
          hidden,
          median(0),
          median(1),
          median(2),
          median(3),
          median(4),
          {
            stroke: colors[3],
            paths: () => null,
            points: { show: true, size: 5, fill: colors[3], stroke: colors[3], width: 0 },
          },
        ],
        bands: [
          { series: [1, 2], fill: css("--chart-smoke") },
          { series: [3, 4], fill: css("--chart-smoke-inner") },
        ],
        plugins: [
          tooltipPlugin((_u, idx, box) => {
            const s = seriesRef.current;
            const rows = rowAtRef.current;
            const k = idx < rows.length ? rows[idx] : -1;
            if (!s || k < 0) return;
            const sent = s.sent[k];
            const recv = s.recv[k];
            const p50 = s.p50[k];
            ttTitle(box, fmtDateTime(s.ts[k]));
            if (p50 == null) {
              if (sent > 0) ttRow(box, "全部丢失", "100%", colors[3]);
              return;
            }
            const loss = sent > 0 ? (100 * (sent - recv)) / sent : 0;
            const color = colors[lossBucket(loss)];
            ttRow(box, `丢包 (${recv}/${sent})`, `${loss.toFixed(0)}%`, color);
            ttRow(box, "中位", fmtMs(p50), color);
            ttRow(box, "P25 – P75", `${fmtMs(s.p25[k])} – ${fmtMs(s.p75[k])}`);
            ttRow(box, "最小 – 最大", `${fmtMs(s.min[k])} – ${fmtMs(s.max[k])}`);
          }),
        ],
      };
    },
    data,
    `${height}:${span}:${syncKey}`,
  );

  return <div ref={ref} className="w-full" style={{ height }} />;
}

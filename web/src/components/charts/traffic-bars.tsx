import { useMemo, useRef } from "react";
import uPlot from "uplot";
import { fmtBytes } from "@/lib/format";
import { axisBase, tooltipPlugin, ttRow, ttTitle, useUPlot } from "./uplot-base";

export interface TrafficBar {
  label: string;
  full: string;
  rx: number;
  tx: number;
}

/**
 * Download below the zero line, upload above it, so the two directions read
 * apart instead of competing for the same side. Axis and tooltip show the
 * magnitudes; only the geometry is signed.
 */
export function TrafficBars({ rows, height = 200 }: { rows: TrafficBar[]; height?: number }) {
  const data = useMemo<uPlot.AlignedData>(
    () => [rows.map((_, i) => i), rows.map((r) => -r.rx), rows.map((r) => r.tx)],
    [rows],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const labels = rows.map((r) => r.label);

  const ref = useUPlot(
    (width, css) => ({
      width,
      height,
      cursor: { points: { show: false }, drag: { x: false, y: false } },
      legend: { show: false },
      scales: {
        x: { time: false, range: (_u, min, max): [number, number] => [min - 0.6, max + 0.6] },
        y: {
          // symmetric, so zero sits in the middle and neither direction wins
          range: (_u, _min, max): [number, number] => {
            const span = max > 0 ? max * 1.08 : 1;
            return [-span, span];
          },
        },
      },
      axes: [
        {
          ...axisBase(css),
          grid: { show: false },
          space: 44,
          splits: (_u, _ax, min, max) => {
            const out: number[] = [];
            for (let i = Math.ceil(min); i <= Math.floor(max); i++) out.push(i);
            return out;
          },
          values: (_u, splits) => splits.map((i) => rowsRef.current[i]?.label ?? ""),
          rotate: labels.length > 16 ? -45 : 0,
        },
        {
          ...axisBase(css),
          size: 58,
          values: (_u, splits) => splits.map((v) => fmtBytes(Math.abs(v), 0)),
        },
      ],
      series: [
        {},
        {
          fill: css("--chart-1"),
          stroke: css("--chart-1"),
          width: 0,
          paths: uPlot.paths.bars?.({ size: [0.42, 24], align: -1, radius: 0.15, gap: 2 }),
          points: { show: false },
        },
        {
          fill: css("--chart-2"),
          stroke: css("--chart-2"),
          width: 0,
          paths: uPlot.paths.bars?.({ size: [0.42, 24], align: 1, radius: 0.15, gap: 2 }),
          points: { show: false },
        },
      ],
      plugins: [
        tooltipPlugin((_u, idx, box) => {
          const r = rowsRef.current[idx];
          if (!r) return;
          ttTitle(box, r.full);
          ttRow(box, "下载", fmtBytes(r.rx), css("--chart-1"));
          ttRow(box, "上传", fmtBytes(r.tx), css("--chart-2"));
          ttRow(box, "合计", fmtBytes(r.rx + r.tx));
        }),
      ],
    }),
    data,
    `${height}:${labels.length}:${labels[0] ?? ""}:${labels[labels.length - 1] ?? ""}`,
  );

  return <div ref={ref} className="w-full" style={{ height }} />;
}

export function TrafficLegend() {
  return (
    <ul className="flex gap-4 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-chart-1" aria-hidden />
        下载（下）
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm bg-chart-2" aria-hidden />
        上传（上）
      </li>
    </ul>
  );
}

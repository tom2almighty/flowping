import { useMemo, useRef } from "react";
import type uPlot from "uplot";
import { fmtDateTime, fmtRate, fmtTick } from "@/lib/format";
import type { MetricRow } from "@/types";
import { axisBase, tooltipPlugin, ttRow, ttTitle, useUPlot } from "./uplot-base";

function withAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** One percent series (CPU or memory) over time. */
export function PercentLine({
  rows,
  field,
  label,
  from,
  to,
  height = 120,
}: {
  rows: MetricRow[];
  field: "cpu" | "mem";
  label: string;
  from: number;
  to: number;
  height?: number;
}) {
  const data = useMemo<uPlot.AlignedData>(
    () => [rows.map((r) => r.ts), rows.map((r) => r[field])],
    [rows, field],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // the window moves every minute; the chart reads it through a ref on setData
  const winRef = useRef<[number, number]>([from, to]);
  winRef.current = [from, to];
  const span = to - from;
  const ref = useUPlot(
    (width, css) => ({
      width,
      height,
      cursor: {
        sync: { key: "fp-metrics" },
        points: { show: false },
        drag: { x: false, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true, range: (): [number, number] => winRef.current },
        y: { range: [0, 100] },
      },
      axes: [
        { ...axisBase(css), space: 70, values: (_u, s) => s.map((v) => fmtTick(v, span)) },
        { ...axisBase(css), size: 40, values: (_u, s) => s.map((v) => `${v}%`) },
      ],
      series: [
        {},
        {
          stroke: css("--chart-1"),
          fill: withAlpha(css("--chart-1"), 0.1),
          width: 2,
          points: { show: false },
        },
      ],
      plugins: [
        tooltipPlugin((_u, idx, box) => {
          const r = rowsRef.current[idx];
          if (!r) return;
          ttTitle(box, fmtDateTime(r.ts));
          ttRow(box, label, `${r[field].toFixed(1)}%`, css("--chart-1"));
        }),
      ],
    }),
    data,
    `${height}:${span}:${field}`,
  );
  return <div ref={ref} className="w-full" style={{ height }} />;
}

/** Download and upload throughput over time. */
export function RateLines({
  rows,
  from,
  to,
  height = 120,
}: {
  rows: MetricRow[];
  from: number;
  to: number;
  height?: number;
}) {
  const data = useMemo<uPlot.AlignedData>(
    () => [rows.map((r) => r.ts), rows.map((r) => r.rx_rate), rows.map((r) => r.tx_rate)],
    [rows],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const winRef = useRef<[number, number]>([from, to]);
  winRef.current = [from, to];
  const span = to - from;
  const ref = useUPlot(
    (width, css) => ({
      width,
      height,
      cursor: {
        sync: { key: "fp-metrics" },
        points: { show: false },
        drag: { x: false, y: false },
      },
      legend: { show: false },
      scales: {
        x: { time: true, range: (): [number, number] => winRef.current },
        y: { range: (_u, _min, max): [number, number] => [0, max > 0 ? max * 1.1 : 1024] },
      },
      axes: [
        { ...axisBase(css), space: 70, values: (_u, s) => s.map((v) => fmtTick(v, span)) },
        { ...axisBase(css), size: 66, values: (_u, s) => s.map((v) => fmtRate(v)) },
      ],
      series: [
        {},
        { stroke: css("--chart-1"), width: 2, points: { show: false } },
        { stroke: css("--chart-2"), width: 2, points: { show: false } },
      ],
      plugins: [
        tooltipPlugin((_u, idx, box) => {
          const r = rowsRef.current[idx];
          if (!r) return;
          ttTitle(box, fmtDateTime(r.ts));
          ttRow(box, "下载", fmtRate(r.rx_rate), css("--chart-1"));
          ttRow(box, "上传", fmtRate(r.tx_rate), css("--chart-2"));
        }),
      ],
    }),
    data,
    `${height}:${span}`,
  );
  return <div ref={ref} className="w-full" style={{ height }} />;
}

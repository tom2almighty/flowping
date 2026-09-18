import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useIsDark } from "@/lib/theme";

export type CssVar = (name: string) => string;

/**
 * Owns one uPlot instance: builds it against the container width and the
 * current CSS variables, rebuilds when the theme flips, resizes with the
 * container and pushes new data without re-creating.
 */
export function useUPlot(
  build: (width: number, css: CssVar) => uPlot.Options,
  data: uPlot.AlignedData,
  key: string,
) {
  const ref = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const buildRef = useRef(build);
  buildRef.current = build;
  const dark = useIsDark();

  // biome-ignore lint/correctness/useExhaustiveDependencies: key names the structural inputs
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(document.documentElement);
    const css: CssVar = (n) => style.getPropertyValue(n).trim();
    const u = new uPlot(buildRef.current(el.clientWidth || 300, css), dataRef.current, el);
    plot.current = u;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0 && w !== u.width) u.setSize({ width: w, height: u.height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [dark, key]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  return ref;
}

/** Hover readout: a crosshair finds the X, one box lists every series. */
export function tooltipPlugin(
  render: (u: uPlot, idx: number, box: HTMLElement) => void,
): uPlot.Plugin {
  let box: HTMLDivElement;
  return {
    hooks: {
      init: (u) => {
        box = document.createElement("div");
        box.className = "fp-tt";
        box.style.display = "none";
        u.over.appendChild(box);
        u.over.addEventListener("mouseleave", () => {
          box.style.display = "none";
        });
      },
      setCursor: (u) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0 || top == null) {
          box.style.display = "none";
          return;
        }
        box.replaceChildren();
        render(u, idx, box);
        if (!box.hasChildNodes()) {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        const w = u.over.clientWidth;
        const h = u.over.clientHeight;
        const bw = box.offsetWidth;
        const bh = box.offsetHeight;
        box.style.left = `${left + 14 + bw > w ? Math.max(0, left - bw - 12) : left + 14}px`;
        box.style.top = `${Math.max(0, Math.min(top - 10, h - bh))}px`;
      },
    },
  };
}

export function ttRow(box: HTMLElement, label: string, value: string, color?: string) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "6px";
  if (color) {
    const key = document.createElement("span");
    key.style.display = "inline-block";
    key.style.width = "10px";
    key.style.height = "2px";
    key.style.background = color;
    key.style.borderRadius = "1px";
    row.appendChild(key);
  }
  const v = document.createElement("strong");
  v.textContent = value;
  const l = document.createElement("span");
  l.textContent = label;
  l.style.opacity = "0.7";
  row.append(v, l);
  box.appendChild(row);
}

export function ttTitle(box: HTMLElement, text: string) {
  const t = document.createElement("div");
  t.className = "fp-tt-title";
  t.textContent = text;
  box.appendChild(t);
}

export function axisBase(css: CssVar): Partial<uPlot.Axis> {
  return {
    stroke: css("--chart-text"),
    font: "11px system-ui, sans-serif",
    grid: { stroke: css("--chart-grid"), width: 1 },
    ticks: { show: false },
  };
}

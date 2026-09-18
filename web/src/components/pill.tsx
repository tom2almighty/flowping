import type * as React from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "serious" | "crit" | "muted" | "info";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok/12 text-foreground [--dot:var(--ok)]",
  warn: "bg-warn/18 text-foreground [--dot:var(--warn)]",
  serious: "bg-serious/18 text-foreground [--dot:var(--serious)]",
  crit: "bg-crit/14 text-foreground [--dot:var(--crit)]",
  muted: "bg-muted text-muted-foreground [--dot:var(--muted-foreground)]",
  info: "bg-accent text-accent-foreground [--dot:var(--primary)]",
};

/** Capsule status marker: a dot plus a label, never color alone. */
export function Pill({
  tone,
  children,
  dot = true,
  className,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap tnum",
        toneClass[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-(--dot)" aria-hidden />}
      {children}
    </span>
  );
}

export function lossTone(loss: number): Tone {
  if (loss <= 0) return "ok";
  if (loss <= 20) return "warn";
  if (loss <= 50) return "serious";
  return "crit";
}

export function pctTone(pct: number): Tone {
  if (pct >= 95) return "crit";
  if (pct >= 85) return "serious";
  if (pct >= 70) return "warn";
  return "ok";
}

/** Thin meter; the fill wears severity, the track is a lighter step. */
export function Meter({ pct, tone, className }: { pct: number; tone?: Tone; className?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const t = tone ?? pctTone(p);
  const fill: Record<Tone, string> = {
    ok: "bg-primary",
    info: "bg-primary",
    warn: "bg-warn",
    serious: "bg-serious",
    crit: "bg-crit",
    muted: "bg-muted-foreground",
  };
  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-primary/15", className)}
      aria-hidden
    >
      <div className={cn("h-full rounded-full", fill[t])} style={{ width: `${p}%` }} />
    </div>
  );
}

export function MeterCell({ pct, label, title }: { pct: number; label?: string; title?: string }) {
  return (
    <div className="flex min-w-16 flex-col gap-1" title={title}>
      <span className="text-xs tnum">{label ?? `${Math.round(pct)}%`}</span>
      <Meter pct={pct} />
    </div>
  );
}

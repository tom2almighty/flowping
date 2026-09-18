import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "serious" | "crit" | "offline" | "info";

const fill: Record<Tone, string> = {
  ok: "var(--bar-ok)",
  warn: "var(--bar-warn)",
  serious: "var(--bar-serious)",
  crit: "var(--bar-crit)",
  offline: "var(--bar-muted)",
  info: "var(--bar-muted)",
};

/** White reads on green and red; the amber and orange steps need dark ink. */
const onFill: Record<Tone, string> = {
  ok: "text-white",
  warn: "text-black/75",
  serious: "text-black/75",
  crit: "text-white",
  offline: "text-white",
  info: "text-white",
};

const dot: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  serious: "bg-serious",
  crit: "bg-crit",
  offline: "bg-offline",
  info: "bg-offline",
};

/** A filled state dot. State is never carried by colour alone: every use
 *  pairs the dot with a label or a tooltip. */
export function StatusDot({
  tone,
  className,
  title,
}: {
  tone: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn("inline-block size-3.5 shrink-0 rounded-full", dot[tone], className)}
      aria-hidden
    />
  );
}

/** Capsule marker for the admin tables, where a dot alone would be ambiguous. */
export function Pill({
  tone = "offline",
  children,
  className,
  title,
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-border tnum",
        className,
      )}
    >
      {dot && <StatusDot tone={tone} className="size-1.5" />}
      {children}
    </span>
  );
}

/**
 * The ServerStatus meter: a full-width track with the value written inside it.
 * The label is drawn twice, the second copy clipped to the fill, so it stays
 * legible over either the fill or the empty track without guessing a threshold.
 */
export function Bar({
  value,
  label,
  tone,
  className,
}: {
  value: number;
  label: string;
  tone: Tone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "relative h-[22px] w-full overflow-hidden rounded-[4px] bg-bar-track",
        className,
      )}
      role="img"
      aria-label={label}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-[4px]"
        style={{ width: `${pct}%`, background: fill[tone] }}
      />
      <span className="absolute inset-y-0 left-0 flex items-center px-2 text-[11px] font-medium text-foreground/80 tnum">
        {label}
      </span>
      <span
        className={cn(
          "absolute inset-y-0 left-0 flex items-center px-2 text-[11px] font-medium tnum",
          onFill[tone],
        )}
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
        aria-hidden
      >
        {label}
      </span>
    </div>
  );
}

export function lossTone(loss: number): Tone {
  if (loss < 1) return "ok";
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

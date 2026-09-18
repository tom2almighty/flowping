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
      className={cn("inline-block size-3 shrink-0 rounded-full sm:size-3.5", dot[tone], className)}
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

/** Ink that reads on each fill. The ambers are too light for white. */
const inkOnFill: Record<Tone, string> = {
  ok: "text-white",
  warn: "text-black/80",
  serious: "text-black/80",
  crit: "text-white",
  offline: "text-white",
  info: "text-white",
};

const ink =
  "flex h-full items-center px-1 text-[10px] font-medium whitespace-nowrap tnum sm:px-1.5 sm:text-[11px]";

/**
 * The ServerStatus meter: a full-width track with the value written inside it.
 * The label is laid out in the flow, so a table column can never be narrower
 * than the reading it holds. A second copy in fill ink is clipped to the fill,
 * which keeps the text legible at any percentage without guessing where the
 * fill ends. `short` stands in below md, where the columns are tight.
 */
export function Bar({
  value,
  label,
  short,
  tone,
  title,
  className,
}: {
  value: number;
  label: string;
  short?: string;
  tone: Tone;
  title?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const text =
    short == null ? (
      label
    ) : (
      <>
        <span className="md:hidden">{short}</span>
        <span className="hidden md:inline">{label}</span>
      </>
    );
  return (
    <div
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-[4px] bg-bar-track sm:h-[22px]",
        className,
      )}
      role="img"
      aria-label={label}
      title={title}
    >
      <span className={cn(ink, "text-foreground/80")}>{text}</span>
      <div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-[4px]"
        style={{ width: `${pct}%`, background: fill[tone] }}
      >
        <span className={cn(ink, "absolute inset-y-0 left-0", inkOnFill[tone])}>{text}</span>
      </div>
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

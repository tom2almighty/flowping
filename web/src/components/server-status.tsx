import { Link } from "react-router";
import { Bar, lossTone, pctTone, StatusDot, type Tone } from "@/components/status";
import {
  CYCLE_LABEL,
  CYCLE_SUFFIX,
  fmtAgo,
  fmtBytesShort,
  fmtDate,
  fmtMoney,
  fmtMs,
  fmtUptime,
  MODE_LABEL,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentView, Target } from "@/types";

/** Uptime while reporting, last-seen while not: the 在线 column. */
export function UptimeCell({ a }: { a: AgentView }) {
  if (a.pending) return <span className="text-muted-foreground">未上报</span>;
  if (a.online) return <span className="tnum">{fmtUptime(a.uptime)}</span>;
  return (
    <span className="text-muted-foreground" title={`最后上报 ${fmtAgo(a.last_seen)}`}>
      离线 {fmtAgo(a.last_seen)}
    </span>
  );
}

/**
 * Expiry as plain text, the way the classic table shows it. A dot appears only
 * when the date is close enough to act on, so state is never colour alone.
 */
export function ExpiryCell({ a }: { a: AgentView }) {
  const b = a.billing;
  if (b.cycle === "free") return <span className="text-muted-foreground">免费</span>;
  if (b.cycle === "lifetime") return <span className="text-muted-foreground">∞</span>;
  const price =
    b.price > 0 ? ` · ${fmtMoney(b.price, b.currency)}${CYCLE_SUFFIX[b.cycle] ?? ""}` : "";
  if (a.days_left == null)
    return (
      <span className="text-muted-foreground" title={`${CYCLE_LABEL[b.cycle]}${price}`}>
        {CYCLE_LABEL[b.cycle]}
      </span>
    );
  const d = a.days_left;
  const tone: Tone | null = d < 0 ? "crit" : d <= 7 ? "serious" : null;
  return (
    <span className="inline-flex items-center gap-1.5 tnum" title={`${b.expires_at}${price}`}>
      {tone && <StatusDot tone={tone} className="size-2" />}
      {d < 0 ? `已到期 ${-d} 天` : d === 0 ? "今天到期" : `${d} 天`}
    </span>
  );
}

/** One badge per monitored target: loss dot, median latency, loss share. */
export function LatencyCell({ a, targets }: { a: AgentView; targets: Target[] }) {
  if (a.pending) return <span className="text-muted-foreground">—</span>;
  const byId = new Map(targets.map((t) => [t.id, t]));
  const pings = a.pings.filter((p) => byId.has(p.target_id));
  if (pings.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {pings.map((p) => {
        const t = byId.get(p.target_id);
        return (
          <span
            key={p.target_id}
            className={cn(
              "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] tnum",
              !a.online && "opacity-60",
            )}
            title={`${t?.name}：中位 ${fmtMs(p.p50)}，丢包 ${p.loss.toFixed(0)}%`}
          >
            <StatusDot tone={lossTone(p.loss)} className="size-1.5" />
            {p.p50 == null ? "丢失" : fmtMs(p.p50)}
            {p.loss >= 1 && <span className="text-muted-foreground">{Math.round(p.loss)}%</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Period traffic against the quota, scaled like the load meters beside it.
 *  No quota means no scale, so it shows a plain total against ∞. */
export function TrafficBar({ a }: { a: AgentView }) {
  const { used, quota, pct } = a.period;
  if (quota > 0) {
    return (
      <Bar
        value={pct}
        label={`${fmtBytesShort(used)} / ${fmtBytesShort(quota)}`}
        tone={pctTone(pct)}
      />
    );
  }
  return (
    <div
      className="flex h-[22px] items-center justify-start rounded-[4px] bg-bar-track px-2 text-[11px] font-medium text-foreground/80 tnum"
      title={`${fmtDate(a.period.start)} 起，不限量，${MODE_LABEL[a.billing.mode] ?? a.billing.mode}`}
    >
      {fmtBytesShort(used)} / ∞
    </div>
  );
}

/** The name cell doubles as the keyboard-reachable link for the whole row. */
export function AgentLink({ a }: { a: AgentView }) {
  return (
    <Link
      to={`/servers/${a.id}`}
      className="font-medium text-foreground hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {a.name}
    </Link>
  );
}

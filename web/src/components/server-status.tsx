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
import type { AgentView, PingView, Target } from "@/types";

/** How many latency badges fit one row. The rest fold into a +N chip. */
export const LATENCY_MAX = 3;

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

/** Pings in the order the targets are sorted, so the row reads left to right
 *  the same way the admin list is arranged. */
function ordered(a: AgentView, targets: Target[]): { ping: PingView; target: Target }[] {
  const rank = new Map(targets.map((t, i) => [t.id, i]));
  return a.pings
    .filter((p) => rank.has(p.target_id))
    .map((p) => ({ ping: p, target: targets[rank.get(p.target_id) as number] }))
    .sort((x, y) => (rank.get(x.ping.target_id) ?? 0) - (rank.get(y.ping.target_id) ?? 0));
}

/** One badge per monitored target, capped so every row keeps one line. */
export function LatencyCell({
  a,
  targets,
  max = LATENCY_MAX,
}: {
  a: AgentView;
  targets: Target[];
  max?: number;
}) {
  if (a.pending) return <span className="text-muted-foreground">—</span>;
  const all = ordered(a, targets);
  if (all.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = all.slice(0, max);
  const rest = all.slice(max);
  return (
    <div className="flex flex-nowrap justify-center gap-1">
      {shown.map(({ ping, target }, idx) => (
        <span
          key={ping.target_id}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1 py-0.5 text-[10px] whitespace-nowrap tnum sm:px-1.5 sm:text-[11px]",
            // phones keep the table narrow by showing one reading only
            idx > 0 && "hidden sm:inline-flex",
            !a.online && "opacity-60",
          )}
          title={`${target.name}：中位 ${fmtMs(ping.p50)}，丢包 ${ping.loss.toFixed(0)}%`}
        >
          <StatusDot tone={lossTone(ping.loss)} className="size-1.5" />
          {ping.p50 == null ? "丢失" : fmtMs(ping.p50)}
          {ping.loss >= 1 && (
            <span className="text-muted-foreground">{Math.round(ping.loss)}%</span>
          )}
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className="hidden shrink-0 items-center rounded bg-muted px-1 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground tnum sm:inline-flex sm:px-1.5 sm:text-[11px]"
          title={rest.map((r) => `${r.target.name}：${fmtMs(r.ping.p50)}`).join("，")}
        >
          +{rest.length}
        </span>
      )}
      {all.length > 1 && (
        <span
          className="inline-flex shrink-0 items-center rounded bg-muted px-1 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground tnum sm:hidden"
          title={all
            .slice(1)
            .map((r) => `${r.target.name}：${fmtMs(r.ping.p50)}`)
            .join("，")}
        >
          +{all.length - 1}
        </span>
      )}
    </div>
  );
}

/** Period traffic against the quota, scaled like the load meters beside it.
 *  No quota means no scale, so it shows a plain total against ∞. The label has
 *  no spaces around the slash so it still fits the narrow column on a phone. */
export function TrafficBar({ a }: { a: AgentView }) {
  const { used, quota, pct } = a.period;
  if (quota > 0) {
    return (
      <Bar
        value={pct}
        label={`${fmtBytesShort(used)}/${fmtBytesShort(quota)}`}
        tone={pctTone(pct)}
      />
    );
  }
  return (
    <div
      className="flex h-4 items-center justify-start rounded-[4px] bg-bar-track px-1.5 text-[10px] font-medium text-foreground/80 tnum sm:h-[22px] sm:px-2 sm:text-[11px]"
      title={`${fmtDate(a.period.start)} 起，不限量，${MODE_LABEL[a.billing.mode] ?? a.billing.mode}`}
    >
      {fmtBytesShort(used)}/∞
    </div>
  );
}

/** The name links to the detail page; the row around it is clickable too. */
export function AgentLink({ a }: { a: AgentView }) {
  return (
    <Link
      to={`/servers/${a.id}`}
      className="block truncate font-medium text-foreground sm:max-w-52"
      title={a.name}
      onClick={(e) => e.stopPropagation()}
    >
      {a.name}
    </Link>
  );
}

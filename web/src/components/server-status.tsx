import { Link } from "react-router";
import { Bar, pctTone, StatusDot, type Tone } from "@/components/status";
import {
  CYCLE_LABEL,
  CYCLE_SUFFIX,
  fmtAgo,
  fmtBytes,
  fmtBytesShort,
  fmtDate,
  fmtMoney,
  fmtUptime,
  MODE_LABEL,
} from "@/lib/format";
import type { AgentView } from "@/types";

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

/**
 * Period traffic against the quota, drawn like the load meters beside it. No
 * quota means nothing to fill: the total sits on an empty track against ∞.
 * The label has no spaces around the slash so it fits the narrow phone column,
 * where it also drops to two significant digits.
 */
export function TrafficBar({ a }: { a: AgentView }) {
  const { used, quota, pct, start } = a.period;
  const mode = MODE_LABEL[a.billing.mode] ?? a.billing.mode;
  const since = `${fmtDate(start)} 起`;
  if (quota > 0) {
    return (
      <Bar
        value={pct}
        label={`${fmtBytesShort(used)}/${fmtBytesShort(quota)}`}
        short={`${fmtBytesShort(used, 2)}/${fmtBytesShort(quota, 2)}`}
        tone={pctTone(pct)}
        title={`${since}已用 ${fmtBytes(used)} / ${fmtBytes(quota)}，${mode}`}
      />
    );
  }
  return (
    <Bar
      value={0}
      label={`${fmtBytesShort(used)}/∞`}
      short={`${fmtBytesShort(used, 2)}/∞`}
      tone="ok"
      title={`${since}已用 ${fmtBytes(used)}，不限量，${mode}`}
    />
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

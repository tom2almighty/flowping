import { useMemo } from "react";
import { Link } from "react-router";
import { Flag } from "@/components/flag";
import { lossTone, Meter, MeterCell, Pill, type Tone } from "@/components/pill";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  CYCLE_LABEL,
  CYCLE_SUFFIX,
  fmtAgo,
  fmtBytes,
  fmtDuration,
  fmtMoney,
  fmtMs,
  fmtRate,
} from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { AgentView, Target } from "@/types";

export function StatusPill({ a }: { a: AgentView }) {
  if (a.pending) return <Pill tone="muted">未上报</Pill>;
  if (a.online)
    return (
      <Pill tone="ok" title={`运行 ${fmtDuration(a.uptime)}`}>
        在线
      </Pill>
    );
  return (
    <Pill tone="crit" title={`最后上报 ${fmtAgo(a.last_seen)}`}>
      离线
    </Pill>
  );
}

export function ExpiryPill({ a }: { a: AgentView }) {
  const b = a.billing;
  const price = b.price > 0 ? `${fmtMoney(b.price, b.currency)}${CYCLE_SUFFIX[b.cycle] ?? ""}` : "";
  if (b.cycle === "free")
    return (
      <Pill tone="muted" dot={false}>
        免费
      </Pill>
    );
  if (b.cycle === "lifetime")
    return (
      <Pill tone="muted" dot={false} title={price}>
        长期{price && ` ${price}`}
      </Pill>
    );
  if (a.days_left == null)
    return (
      <Pill tone="muted" dot={false}>
        {CYCLE_LABEL[b.cycle]}
        {price && ` ${price}`}
      </Pill>
    );
  const d = a.days_left;
  const tone: Tone = d < 0 ? "crit" : d <= 3 ? "serious" : d <= 7 ? "warn" : "ok";
  const text = d < 0 ? `已到期 ${-d} 天` : d === 0 ? "今天到期" : `${d} 天后到期`;
  return (
    <Pill tone={tone} title={`${b.expires_at}${price ? ` · ${price}` : ""}`}>
      {text}
    </Pill>
  );
}

export function PingPills({ a, targets }: { a: AgentView; targets: Target[] }) {
  if (!a.online || a.pings.length === 0) return <span className="text-muted-foreground">—</span>;
  const byId = new Map(targets.map((t) => [t.id, t]));
  return (
    <div className="flex flex-wrap gap-1">
      {a.pings.map((p) => {
        const t = byId.get(p.target_id);
        if (!t) return null;
        return (
          <Pill
            key={p.target_id}
            tone={lossTone(p.loss)}
            title={`${t.name}：中位 ${fmtMs(p.p50)}，丢包 ${p.loss.toFixed(0)}%`}
          >
            <span className="font-normal opacity-80">{t.name}</span>
            {p.p50 == null ? "丢失" : fmtMs(p.p50)}
            {p.loss > 0 && <span className="opacity-80">{p.loss.toFixed(0)}%</span>}
          </Pill>
        );
      })}
    </div>
  );
}

function TrafficCell({ a }: { a: AgentView }) {
  const m = a.month;
  const total = m.rx + m.tx;
  const hasQuota = a.period.quota > 0;
  return (
    <div className="flex min-w-28 flex-col gap-1">
      <span className="tnum" title={`下载 ${fmtBytes(m.rx)}，上传 ${fmtBytes(m.tx)}`}>
        {fmtBytes(total)}
      </span>
      {hasQuota ? (
        <div className="flex items-center gap-2">
          <Meter pct={a.period.pct} className="flex-1" />
          <span className="text-xs text-muted-foreground tnum">
            {a.period.pct.toFixed(0)}% / {fmtBytes(a.period.quota, 0)}
          </span>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground tnum">
          ↓ {fmtBytes(m.rx)} ↑ {fmtBytes(m.tx)}
        </span>
      )}
    </div>
  );
}

export function Dashboard() {
  const agents = usePoll(() => api.get<AgentView[]>("/api/v1/agents"), 5000);
  const targets = usePoll(() => api.get<Target[]>("/api/v1/targets"), 60000);
  const list = agents.data ?? [];
  const summary = useMemo(() => {
    const online = list.filter((a) => a.online).length;
    const pending = list.filter((a) => a.pending).length;
    const offline = list.length - online - pending;
    const month = list.reduce((s, a) => s + a.month.rx + a.month.tx, 0);
    const parts = [`${list.length} 台服务器`, `${online} 台在线`];
    if (offline > 0) parts.push(`${offline} 台离线`);
    if (pending > 0) parts.push(`${pending} 台等待首次上报`);
    const text =
      list.length === 0
        ? "还没有服务器。"
        : `${parts.join("，")}。本月合计流量 ${fmtBytes(month)}。`;
    return { text };
  }, [list]);

  if (agents.error && !agents.data) {
    return <Empty>{agents.error.message}</Empty>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{summary.text}</p>
      {list.length === 0 ? (
        <Empty>登录后台后添加第一台服务器，几秒内它就会出现在这里。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>服务器</TH>
                <TH>状态</TH>
                <TH>CPU</TH>
                <TH>内存</TH>
                <TH>磁盘</TH>
                <TH>网速</TH>
                <TH>本月流量</TH>
                <TH>延迟</TH>
                <TH>到期</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((a) => {
                const mem = a.mem_total ? (100 * a.mem_used) / a.mem_total : 0;
                const disk = a.disk_total ? (100 * a.disk_used) / a.disk_total : 0;
                const dim = !a.online;
                return (
                  <TR key={a.id} className={dim ? "text-muted-foreground" : undefined}>
                    <TD>
                      <Link to={`/servers/${a.id}`} className="group flex items-center gap-2.5">
                        <Flag code={a.country} />
                        <span className="flex flex-col">
                          <span className="font-medium text-foreground group-hover:underline">
                            {a.name}
                          </span>
                          {a.note && (
                            <span className="text-xs text-muted-foreground">{a.note}</span>
                          )}
                        </span>
                      </Link>
                    </TD>
                    <TD>
                      <StatusPill a={a} />
                    </TD>
                    <TD>
                      {a.online ? (
                        <MeterCell
                          pct={a.cpu}
                          title={`负载 ${a.load.map((l) => l.toFixed(2)).join(" ")}`}
                        />
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      {a.online ? (
                        <MeterCell
                          pct={mem}
                          title={`${fmtBytes(a.mem_used)} / ${fmtBytes(a.mem_total)}`}
                        />
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      {a.online ? (
                        <MeterCell
                          pct={disk}
                          title={`${fmtBytes(a.disk_used)} / ${fmtBytes(a.disk_total)}`}
                        />
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="tnum">
                      {a.online ? (
                        <span className="flex flex-col text-xs leading-5">
                          <span>↓ {fmtRate(a.rx_rate)}</span>
                          <span>↑ {fmtRate(a.tx_rate)}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <TrafficCell a={a} />
                    </TD>
                    <TD>
                      <PingPills a={a} targets={targets.data ?? []} />
                    </TD>
                    <TD>
                      <ExpiryPill a={a} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

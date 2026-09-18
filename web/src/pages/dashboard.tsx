import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { Flag } from "@/components/flag";
import {
  AgentLink,
  ExpiryCell,
  LatencyCell,
  TrafficBar,
  UptimeCell,
} from "@/components/server-status";
import { Bar, pctTone, StatusDot } from "@/components/status";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtLoad, fmtRateShort } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { AgentView, Target } from "@/types";

/** "Debian GNU/Linux 12" reads as "Debian 12" in a narrow column. */
function osShort(os: string): string {
  const parts = os.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const version = parts.find((p) => /^\d/.test(p));
  return version ? `${parts[0]} ${version}` : parts[0];
}

function stateTone(a: AgentView) {
  if (a.pending) return "offline" as const;
  return a.online ? ("ok" as const) : ("crit" as const);
}

function stateText(a: AgentView) {
  if (a.pending) return "未上报";
  return a.online ? "在线" : "离线";
}

function memPct(a: AgentView) {
  return a.mem_total ? (100 * a.mem_used) / a.mem_total : 0;
}

function diskPct(a: AgentView) {
  return a.disk_total ? (100 * a.disk_used) / a.disk_total : 0;
}

/** Small screens get a stack per server: the same fields, no sideways scroll. */
function AgentCards({ list, targets }: { list: AgentView[]; targets: Target[] }) {
  return (
    <ul className="flex flex-col gap-1.5 px-2 pb-2 md:hidden">
      {list.map((a) => {
        const mem = memPct(a);
        const disk = diskPct(a);
        const off = !a.online;
        return (
          <li key={a.id}>
            <Link
              to={`/servers/${a.id}`}
              className="flex flex-col gap-2 rounded-md bg-row px-3 py-2.5 transition-colors active:bg-row-hover"
            >
              <div className="flex items-center gap-2">
                <StatusDot tone={stateTone(a)} title={stateText(a)} />
                <Flag code={a.country} />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <LatencyCell a={a} targets={targets} max={2} />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <Bar
                  value={off ? 0 : a.cpu}
                  label={off ? "—" : `${a.cpu.toFixed(0)}%`}
                  tone={pctTone(a.cpu)}
                />
                <Bar
                  value={off ? 0 : mem}
                  label={off ? "—" : `${mem.toFixed(0)}%`}
                  tone={pctTone(mem)}
                />
                <Bar
                  value={off ? 0 : disk}
                  label={off ? "—" : `${disk.toFixed(0)}%`}
                  tone={pctTone(disk)}
                />
              </div>
              <TrafficBar a={a} />
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground tnum">
                <span>
                  ↓{fmtRateShort(a.rx_rate)}/s ↑{fmtRateShort(a.tx_rate)}/s
                </span>
                <span className="flex items-center gap-2">
                  <UptimeCell a={a} />
                  <ExpiryCell a={a} />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const agents = usePoll(() => api.get<AgentView[]>("/api/v1/agents"), 5000);
  const targets = usePoll(() => api.get<Target[]>("/api/v1/targets"), 60000);
  const list = agents.data ?? [];

  const summary = useMemo(() => {
    const online = list.filter((a) => a.online);
    const pending = list.filter((a) => a.pending).length;
    const offline = list.length - online.length - pending;
    const rx = online.reduce((s, a) => s + a.rx_rate, 0);
    const tx = online.reduce((s, a) => s + a.tx_rate, 0);
    const parts = [`在线 ${online.length} / ${list.length}`];
    if (offline > 0) parts.push(`离线 ${offline}`);
    if (pending > 0) parts.push(`待上报 ${pending}`);
    parts.push(`↓${fmtRateShort(rx)}/s`, `↑${fmtRateShort(tx)}/s`);
    return parts.join(" · ");
  }, [list]);

  if (agents.error && !agents.data) return <Empty>{agents.error.message}</Empty>;

  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
        <h1 className="text-lg font-semibold">服务器</h1>
        <p className="text-xs text-muted-foreground tnum">{summary}</p>
      </header>
      {list.length === 0 ? (
        <div className="px-5 pb-5">
          <Empty>登录后台添加第一台服务器，几秒内它就会出现在这里。</Empty>
        </div>
      ) : (
        <>
          <AgentCards list={list} targets={targets.data ?? []} />
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH className="w-14">状态</TH>
                  <TH>名称</TH>
                  <TH>位置</TH>
                  <TH>系统</TH>
                  <TH>在线</TH>
                  <TH>到期</TH>
                  <TH>负载</TH>
                  <TH>网速 ↓↑</TH>
                  <TH className="w-36">CPU</TH>
                  <TH className="w-36">内存</TH>
                  <TH className="w-36">硬盘</TH>
                  <TH className="w-36">流量</TH>
                  <TH>延迟</TH>
                </TR>
              </THead>
              <TBody>
                {list.map((a) => {
                  const mem = memPct(a);
                  const disk = diskPct(a);
                  const off = !a.online;
                  return (
                    <TR
                      key={a.id}
                      className="h-12 cursor-pointer"
                      onClick={() => navigate(`/servers/${a.id}`)}
                    >
                      <TD>
                        <span className="flex justify-center">
                          <StatusDot tone={stateTone(a)} title={stateText(a)} />
                        </span>
                      </TD>
                      <TD>
                        <AgentLink a={a} />
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-1.5">
                          <Flag code={a.country} />
                          <span className="text-xs text-muted-foreground uppercase">
                            {a.country || "—"}
                          </span>
                        </span>
                      </TD>
                      <TD className="text-muted-foreground">{osShort(a.os) || "—"}</TD>
                      <TD>
                        <UptimeCell a={a} />
                      </TD>
                      <TD>
                        <ExpiryCell a={a} />
                      </TD>
                      <TD className="text-muted-foreground tnum">{fmtLoad(a.load[0])}</TD>
                      <TD className="text-muted-foreground tnum">
                        {off ? "—" : `${fmtRateShort(a.rx_rate)} | ${fmtRateShort(a.tx_rate)}`}
                      </TD>
                      <TD>
                        {off ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Bar value={a.cpu} label={`${a.cpu.toFixed(1)}%`} tone={pctTone(a.cpu)} />
                        )}
                      </TD>
                      <TD>
                        {off ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Bar value={mem} label={`${mem.toFixed(1)}%`} tone={pctTone(mem)} />
                        )}
                      </TD>
                      <TD>
                        {off ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Bar value={disk} label={`${disk.toFixed(1)}%`} tone={pctTone(disk)} />
                        )}
                      </TD>
                      <TD>
                        <TrafficBar a={a} />
                      </TD>
                      <TD>
                        <LatencyCell a={a} targets={targets.data ?? []} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </>
      )}
      <p className="px-5 pb-4 text-xs text-muted-foreground">点击任意一行查看该服务器的明细。</p>
    </section>
  );
}

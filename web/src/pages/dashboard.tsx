import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Flag } from "@/components/flag";
import { OsIcon } from "@/components/os-icon";
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
        <Table>
          <THead>
            <TR>
              <TH className="w-6 sm:w-10">状态</TH>
              <TH className="w-24 sm:w-36 md:w-44 xl:w-52">名称</TH>
              <TH className="w-6 sm:w-10">位置</TH>
              <TH className="hidden sm:table-cell sm:w-10">系统</TH>
              <TH className="hidden lg:table-cell">在线</TH>
              <TH className="hidden lg:table-cell">到期</TH>
              <TH className="hidden lg:table-cell">负载</TH>
              <TH className="hidden lg:table-cell">网速 ↓↑</TH>
              <TH className="hidden w-24 md:table-cell">CPU</TH>
              <TH className="hidden w-24 md:table-cell">内存</TH>
              <TH className="hidden w-24 md:table-cell">硬盘</TH>
              <TH className="w-20 sm:w-24">流量</TH>
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
                  className="h-10 cursor-pointer sm:h-12"
                  onClick={() => navigate(`/servers/${a.id}`)}
                >
                  <TD>
                    <span className="flex justify-center">
                      <StatusDot tone={stateTone(a)} title={stateText(a)} />
                    </span>
                  </TD>
                  <TD className="max-w-0">
                    <AgentLink a={a} />
                  </TD>
                  <TD>
                    <Flag code={a.country} title={a.country || "未知地区"} />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <span className="flex justify-center">
                      <OsIcon os={a.os} />
                    </span>
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <UptimeCell a={a} />
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <ExpiryCell a={a} />
                  </TD>
                  <TD className="hidden text-muted-foreground tnum lg:table-cell">
                    {fmtLoad(a.load[0])}
                  </TD>
                  <TD className="hidden text-muted-foreground tnum lg:table-cell">
                    {off ? "—" : `${fmtRateShort(a.rx_rate)} | ${fmtRateShort(a.tx_rate)}`}
                  </TD>
                  <TD className="hidden md:table-cell">
                    {off ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Bar value={a.cpu} label={`${a.cpu.toFixed(1)}%`} tone={pctTone(a.cpu)} />
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
                    {off ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Bar value={mem} label={`${mem.toFixed(1)}%`} tone={pctTone(mem)} />
                    )}
                  </TD>
                  <TD className="hidden md:table-cell">
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
      )}
    </section>
  );
}

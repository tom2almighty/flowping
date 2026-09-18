import { useMemo } from "react";
import { useNavigate } from "react-router";
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
              const mem = a.mem_total ? (100 * a.mem_used) / a.mem_total : 0;
              const disk = a.disk_total ? (100 * a.disk_used) / a.disk_total : 0;
              const idle = !a.online;
              return (
                <TR
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/servers/${a.id}`)}
                >
                  <TD>
                    <span className="flex justify-center">
                      <StatusDot
                        tone={a.pending ? "offline" : a.online ? "ok" : "crit"}
                        title={a.pending ? "未上报" : a.online ? "在线" : "离线"}
                      />
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
                  <TD className="tnum text-muted-foreground">{fmtLoad(a.load[0])}</TD>
                  <TD className="tnum text-muted-foreground">
                    {idle ? "—" : `${fmtRateShort(a.rx_rate)} | ${fmtRateShort(a.tx_rate)}`}
                  </TD>
                  <TD>
                    {idle ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Bar value={a.cpu} label={`${a.cpu.toFixed(1)}%`} tone={pctTone(a.cpu)} />
                    )}
                  </TD>
                  <TD>
                    {idle ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Bar value={mem} label={`${mem.toFixed(1)}%`} tone={pctTone(mem)} />
                    )}
                  </TD>
                  <TD>
                    {idle ? (
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
      <p className="px-5 pb-4 text-xs text-muted-foreground">点击任意一行查看该服务器的明细。</p>
    </section>
  );
}

import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Flag } from "@/components/flag";
import { OsIcon } from "@/components/os-icon";
import { AgentLink, ExpiryCell, TrafficBar, UptimeCell } from "@/components/server-status";
import { Bar, pctTone, StatusDot } from "@/components/status";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtBytes, fmtLoad, fmtRateShort } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/utils";
import type { AgentView } from "@/types";

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

/** Usage meter: one decimal from md up, whole percent on tighter screens. The
 *  column never shrinks below the label, so the widths below are floors. */
function Meter({ value, title }: { value: number; title: string }) {
  return (
    <Bar
      value={value}
      label={`${value.toFixed(1)}%`}
      short={`${Math.round(value)}%`}
      tone={pctTone(value)}
      title={title}
    />
  );
}

/* Meter columns: floors per breakpoint, chosen so every breakpoint's columns
   add up inside the viewport (a specified width raises the column's minimum,
   and an over-constrained table scrolls instead of shrinking). Phones leave
   them to share whatever the fixed columns leave over, which is why CPU waits
   for sm; lg is the tightest, where the four text columns join in; xl has
   room for everything. */
const meter = "sm:w-18 md:w-20 lg:w-18 xl:w-24 2xl:w-28";
const quota = "sm:w-24 md:w-28 lg:w-22 xl:w-28 2xl:w-32";

export function Dashboard() {
  const navigate = useNavigate();
  const agents = usePoll(() => api.get<AgentView[]>("/api/v1/agents"), 5000);
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
              <TH className="w-24 sm:w-32 md:w-44 lg:w-28 xl:w-52">名称</TH>
              <TH className="w-6 sm:w-10">位置</TH>
              <TH className="hidden sm:table-cell sm:w-10">系统</TH>
              <TH className="hidden lg:table-cell">在线</TH>
              <TH className="hidden lg:table-cell">到期</TH>
              <TH className="hidden lg:table-cell">负载</TH>
              <TH className="hidden lg:table-cell">网速 ↓↑</TH>
              <TH className={cn("hidden sm:table-cell", meter)}>CPU</TH>
              <TH className={meter}>内存</TH>
              <TH className={meter}>硬盘</TH>
              <TH className={quota}>流量</TH>
            </TR>
          </THead>
          <TBody>
            {list.map((a) => {
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
                  <TD className="hidden sm:table-cell">
                    {off ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Meter value={a.cpu} title={`负载 ${a.load.map(fmtLoad).join(" / ")}`} />
                    )}
                  </TD>
                  <TD>
                    {off ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Meter
                        value={memPct(a)}
                        title={`${fmtBytes(a.mem_used)} / ${fmtBytes(a.mem_total)}`}
                      />
                    )}
                  </TD>
                  <TD>
                    {off ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Meter
                        value={diskPct(a)}
                        title={`${fmtBytes(a.disk_used)} / ${fmtBytes(a.disk_total)}`}
                      />
                    )}
                  </TD>
                  <TD>
                    <TrafficBar a={a} />
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

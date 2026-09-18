import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { COMPARE_MAX, CompareChart, compareItems } from "@/components/charts/compare-chart";
import { PercentLine, RateLines } from "@/components/charts/metric-lines";
import { LossLegend, SmokeChart } from "@/components/charts/smoke-chart";
import { TrafficBars, TrafficLegend } from "@/components/charts/traffic-bars";
import { Flag } from "@/components/flag";
import { ExpiryCell, UptimeCell } from "@/components/server-status";
import { Bar, pctTone, StatusDot } from "@/components/status";
import { Empty, Segmented, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  CYCLE_LABEL,
  CYCLE_SUFFIX,
  fmtBytes,
  fmtDate,
  fmtDuration,
  fmtLoad,
  fmtMoney,
  fmtRate,
  fmtTime,
  MODE_LABEL,
} from "@/lib/format";
import { useNow, usePoll } from "@/lib/use-poll";
import type { AgentView, HourRow, MetricRow, PingResponse, Target, TrafficRow } from "@/types";

export const rangeOptions = [
  { value: "3h", label: "3 小时", secs: 3 * 3600 },
  { value: "24h", label: "24 小时", secs: 86400 },
  { value: "7d", label: "7 天", secs: 7 * 86400 },
  { value: "30d", label: "30 天", secs: 30 * 86400 },
  { value: "1y", label: "1 年", secs: 365 * 86400 },
] as const;
export type RangeKey = (typeof rangeOptions)[number]["value"];

export function rangeSecs(k: RangeKey) {
  return rangeOptions.find((r) => r.value === k)?.secs ?? 86400;
}

/** Aligns the window to the query step so polling does not shift buckets. */
export function useWindow(range: RangeKey, everyMs = 60000) {
  const secs = rangeSecs(range);
  const now = useNow(everyMs);
  return useMemo(() => {
    const step = secs <= 36 * 3600 ? 60 : secs <= 8 * 86400 ? 300 : 3600;
    const to = Math.ceil(now / 1000 / step) * step;
    return { from: to - secs, to, step };
  }, [secs, now]);
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 tnum">{children}</dd>
    </div>
  );
}

function Vitals({ a }: { a: AgentView }) {
  const mem = a.mem_total ? (100 * a.mem_used) / a.mem_total : 0;
  const disk = a.disk_total ? (100 * a.disk_used) / a.disk_total : 0;
  const swap = a.swap_total > 0 ? `${fmtBytes(a.swap_used)} / ${fmtBytes(a.swap_total)}` : "未启用";
  const b = a.billing;
  const off = !a.online;
  return (
    <dl className="grid gap-x-8 gap-y-2.5 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
      <Row label="系统">{a.os || "—"}</Row>
      <Row label="内核">{a.kernel || "—"}</Row>
      <Row label="架构">
        {a.arch}
        {a.cpus > 0 && ` · ${a.cpus} 核`}
      </Row>
      <Row label="主机名">{a.hostname || "—"}</Row>
      <Row label="在线">
        <UptimeCell a={a} />
      </Row>
      <Row label="时区">{a.tz || "—"}</Row>
      <Row label="CPU">
        {off ? (
          "—"
        ) : (
          <span className="inline-flex items-center gap-3">
            <span className="w-32">
              <Bar value={a.cpu} label={`${a.cpu.toFixed(1)}%`} tone={pctTone(a.cpu)} />
            </span>
            <span className="text-muted-foreground">负载 {a.load.map(fmtLoad).join(" / ")}</span>
          </span>
        )}
      </Row>
      <Row label="内存">
        {off ? (
          "—"
        ) : (
          <span className="inline-flex items-center gap-3">
            <span className="w-32">
              <Bar value={mem} label={`${mem.toFixed(1)}%`} tone={pctTone(mem)} />
            </span>
            <span className="text-muted-foreground">
              {fmtBytes(a.mem_used)} / {fmtBytes(a.mem_total)}
            </span>
          </span>
        )}
      </Row>
      <Row label="交换">{off ? "—" : swap}</Row>
      <Row label="硬盘">
        {off ? (
          "—"
        ) : (
          <span className="inline-flex items-center gap-3">
            <span className="w-32">
              <Bar value={disk} label={`${disk.toFixed(1)}%`} tone={pctTone(disk)} />
            </span>
            <span className="text-muted-foreground">
              {fmtBytes(a.disk_used)} / {fmtBytes(a.disk_total)}
            </span>
          </span>
        )}
      </Row>
      <Row label="网速">
        {off ? "—" : `↓ ${fmtRate(a.rx_rate)} · ↑ ${fmtRate(a.tx_rate)}`}
        {a.iface && <span className="text-muted-foreground"> · {a.iface}</span>}
      </Row>
      <Row label="流量配额">
        {a.period.quota > 0 ? (
          <span className="inline-flex items-center gap-3">
            <span className="w-32">
              <Bar
                value={a.period.pct}
                label={`${a.period.pct.toFixed(0)}%`}
                tone={pctTone(a.period.pct)}
              />
            </span>
            <span className="text-muted-foreground">
              {fmtBytes(a.period.used)} / {fmtBytes(a.period.quota)} ·{" "}
              {MODE_LABEL[b.mode] ?? b.mode} · 每月 {b.reset_day} 日重置
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            不限量 · {MODE_LABEL[b.mode] ?? b.mode} · 每月 {b.reset_day} 日重置
          </span>
        )}
      </Row>
      <Row label="今日流量">
        ↓ {fmtBytes(a.today.rx)} · ↑ {fmtBytes(a.today.tx)}
      </Row>
      <Row label="本月流量">
        ↓ {fmtBytes(a.month.rx)} · ↑ {fmtBytes(a.month.tx)}
      </Row>
      <Row label="本年流量">
        ↓ {fmtBytes(a.year.rx)} · ↑ {fmtBytes(a.year.tx)}
      </Row>
      <Row label="累计流量">
        ↓ {fmtBytes(a.total.rx)} · ↑ {fmtBytes(a.total.tx)}
      </Row>
      <Row label="续费">
        {b.price > 0 ? (
          <>
            {fmtMoney(b.price, b.currency)}
            {CYCLE_SUFFIX[b.cycle] ?? ""}
            {b.auto_renew && <span className="text-muted-foreground"> · 自动续期</span>}
          </>
        ) : (
          <span className="text-muted-foreground">{CYCLE_LABEL[b.cycle]}</span>
        )}
      </Row>
      <Row label="到期">
        <ExpiryCell a={a} />
      </Row>
      <Row label="Agent">{a.agent_version || "—"}</Row>
    </dl>
  );
}

type View = "smoke" | "compare";

function LatencySection({ a, targets }: { a: AgentView; targets: Target[] }) {
  const [range, setRange] = useState<RangeKey>("24h");
  const [view, setView] = useState<View>("smoke");
  const win = useWindow(range);
  const res = usePoll(
    () => api.get<PingResponse>(`/api/v1/ping?agent=${a.id}&from=${win.from}&to=${win.to}`),
    60000,
    [a.id, win.from, win.to],
  );
  const mine = targets.filter((t) => t.agent_ids.length === 0 || t.agent_ids.includes(a.id));
  // raw rows sit at each probe cycle's own timestamp, so the slot width is the
  // target's interval; aggregated tiers already come bucketed by the hub
  const stepFor = (interval: number) => {
    const d = res.data;
    if (!d) return win.step;
    return d.tier === "ping_raw" ? interval : d.step;
  };
  // overlaid probes share one grid, so it has to be the widest cycle on screen
  const rawStep = mine.length > 0 ? Math.max(...mine.map((t) => t.interval)) : 60;
  const { items, truncated } = compareItems(
    mine,
    (t) => t.id,
    (t) => t.name,
    (t) => res.data?.series.find((s) => s.target_id === t.id),
  );
  const rangeLabel = rangeOptions.find((r) => r.value === range)?.label ?? "";

  return (
    <Section
      title={`网络延迟 · 最近 ${rangeLabel}`}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            ariaLabel="延迟视图"
            value={view}
            onChange={setView}
            options={[
              { value: "smoke", label: "烟雾图" },
              { value: "compare", label: "对比" },
            ]}
          />
          <Segmented
            ariaLabel="延迟时间范围"
            value={range}
            onChange={setRange}
            options={rangeOptions.map((r) => ({ value: r.value, label: r.label }))}
          />
        </div>
      }
    >
      {mine.length === 0 ? (
        <Empty>还没有给这台服务器分配延迟监测目标。</Empty>
      ) : (
        <div
          className={`flex flex-col gap-3 ${res.loading ? "opacity-60" : ""} transition-opacity`}
        >
          {view === "smoke" ? (
            <>
              <LossLegend />
              <div className="grid gap-4 xl:grid-cols-2">
                {mine.map((t) => (
                  <div key={t.id}>
                    <div className="mb-1 flex items-baseline justify-between px-1">
                      <span className="text-sm font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground">毫秒</span>
                    </div>
                    <SmokeChart
                      series={res.data?.series.find((s) => s.target_id === t.id)}
                      from={win.from}
                      to={win.to}
                      step={stepFor(t.interval)}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <CompareChart
              items={items}
              from={win.from}
              to={win.to}
              step={stepFor(rawStep)}
              height={240}
              hint={
                <>
                  毫秒；丢包是整段时间的合计；点图例可显示或隐藏某条线。
                  {truncated > 0 && ` 只画了前 ${COMPARE_MAX} 个目标，其余看烟雾图。`}
                </>
              }
            />
          )}
        </div>
      )}
    </Section>
  );
}

type Period = "hour" | "day" | "month" | "year";

function TrafficSection({ a }: { a: AgentView }) {
  const [period, setPeriod] = useState<Period>("day");
  const rows = usePoll(
    () => api.get<(TrafficRow | HourRow)[]>(`/api/v1/agents/${a.id}/traffic?period=${period}`),
    60000,
    [a.id, period],
  );
  const bars = useMemo(() => {
    const data = rows.data ?? [];
    return data.map((r) => ({
      label:
        "hour" in r
          ? fmtTime(r.hour)
          : period === "day"
            ? r.key.slice(5)
            : period === "month"
              ? r.key.slice(2)
              : r.key,
      full: "hour" in r ? `${fmtDate(r.hour)} ${fmtTime(r.hour)}` : r.key,
      rx: r.rx,
      tx: r.tx,
    }));
  }, [rows.data, period]);

  return (
    <Section
      title="流量"
      aside={
        <Segmented
          ariaLabel="流量统计周期"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "hour", label: "小时" },
            { value: "day", label: "日" },
            { value: "month", label: "月" },
            { value: "year", label: "年" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TrafficLegend />
          <span className="text-xs text-muted-foreground">
            {period === "hour"
              ? "最近 48 小时"
              : { day: "最近 31 天", month: "最近 24 个月", year: "历年" }[period]}
          </span>
        </div>
        <div className={rows.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {bars.length === 0 ? <Empty>还没有这个周期的数据。</Empty> : <TrafficBars rows={bars} />}
        </div>
        {bars.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground select-none">
              数据表
            </summary>
            <Table className="mt-2">
              <THead>
                <TR>
                  <TH>时间</TH>
                  <TH>下载</TH>
                  <TH>上传</TH>
                  <TH>合计</TH>
                </TR>
              </THead>
              <TBody>
                {[...bars].reverse().map((r) => (
                  <TR key={r.full} className="tnum">
                    <TD>{r.full}</TD>
                    <TD>{fmtBytes(r.rx)}</TD>
                    <TD>{fmtBytes(r.tx)}</TD>
                    <TD>{fmtBytes(r.rx + r.tx)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </details>
        )}
      </div>
    </Section>
  );
}

function MetricsSection({ a }: { a: AgentView }) {
  const [hours, setHours] = useState<"6" | "24" | "72">("24");
  const now = useNow(60000);
  const to = Math.floor(now / 60000) * 60;
  const from = to - Number(hours) * 3600;
  const rows = usePoll(
    () => api.get<MetricRow[]>(`/api/v1/agents/${a.id}/metrics?hours=${hours}`),
    60000,
    [a.id, hours],
  );
  const data = rows.data ?? [];
  return (
    <Section
      title="负载"
      aside={
        <Segmented
          ariaLabel="负载时间范围"
          value={hours}
          onChange={setHours}
          options={[
            { value: "6", label: "6 小时" },
            { value: "24", label: "24 小时" },
            { value: "72", label: "3 天" },
          ]}
        />
      }
    >
      <div
        className={`grid gap-6 lg:grid-cols-3 ${rows.loading ? "opacity-60" : ""} transition-opacity`}
      >
        <div>
          <div className="mb-1 px-1 text-xs text-muted-foreground">CPU</div>
          <PercentLine rows={data} field="cpu" label="CPU" from={from} to={to} />
        </div>
        <div>
          <div className="mb-1 px-1 text-xs text-muted-foreground">内存</div>
          <PercentLine rows={data} field="mem" label="内存" from={from} to={to} />
        </div>
        <div>
          <div className="mb-1 px-1 text-xs text-muted-foreground">网速</div>
          <RateLines rows={data} from={from} to={to} />
        </div>
      </div>
    </Section>
  );
}

export function ServerPage() {
  const { id = "" } = useParams();
  const agent = usePoll(() => api.get<AgentView>(`/api/v1/agents/${id}`), 5000, [id]);
  const targets = usePoll(() => api.get<Target[]>("/api/v1/targets"), 60000);
  const a = agent.data;
  if (agent.error && !a) {
    return (
      <Empty>
        {agent.error.message}
        <div className="mt-2">
          <Link to="/" className="text-primary underline-offset-4 hover:underline">
            返回列表
          </Link>
        </div>
      </Empty>
    );
  }
  if (!a) return null;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
        ← 全部服务器
      </Link>
      <section className="rounded-lg border bg-card shadow-xs">
        <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <Flag code={a.country} className="h-[18px] w-6" />
          <h1 className="text-lg font-semibold">{a.name}</h1>
          <span className="flex items-center gap-1.5">
            <StatusDot
              tone={a.pending ? "offline" : a.online ? "ok" : "crit"}
              title={a.pending ? "未上报" : a.online ? "在线" : "离线"}
            />
            <span className="text-xs text-muted-foreground">
              {a.pending ? "未上报" : a.online ? `已运行 ${fmtDuration(a.uptime)}` : "离线"}
            </span>
          </span>
          {a.note && <span className="text-xs text-muted-foreground">{a.note}</span>}
        </header>
        <Vitals a={a} />
      </section>
      <LatencySection a={a} targets={targets.data ?? []} />
      <TrafficSection a={a} />
      <MetricsSection a={a} />
    </div>
  );
}

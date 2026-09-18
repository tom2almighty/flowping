import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { PercentLine, RateLines } from "@/components/charts/metric-lines";
import { LossLegend, SmokeChart } from "@/components/charts/smoke-chart";
import { TrafficBars, TrafficLegend } from "@/components/charts/traffic-bars";
import { Flag } from "@/components/flag";
import { Meter, pctTone } from "@/components/pill";
import { Empty, Segmented, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  CYCLE_LABEL,
  fmtBytes,
  fmtDate,
  fmtDuration,
  fmtMoney,
  fmtRate,
  fmtTime,
  MODE_LABEL,
} from "@/lib/format";
import { useNow, usePoll } from "@/lib/use-poll";
import type { AgentView, HourRow, MetricRow, PingResponse, Target, TrafficRow } from "@/types";
import { ExpiryPill, StatusPill } from "./dashboard";

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

function Stat({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
}) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold leading-tight">{value}</span>
      {sub && <span className="text-xs text-muted-foreground tnum">{sub}</span>}
      {pct != null && <Meter pct={pct} tone={pctTone(pct)} className="mt-1 max-w-40" />}
    </div>
  );
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
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Period = "hour" | "day" | "month" | "year";

function TrafficPanel({ a }: { a: AgentView }) {
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
  const b = a.billing;
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 sm:grid-cols-5">
        <Stat
          label="今日"
          value={fmtBytes(a.today.rx + a.today.tx)}
          sub={`↓ ${fmtBytes(a.today.rx)} ↑ ${fmtBytes(a.today.tx)}`}
        />
        <Stat
          label="本月"
          value={fmtBytes(a.month.rx + a.month.tx)}
          sub={`↓ ${fmtBytes(a.month.rx)} ↑ ${fmtBytes(a.month.tx)}`}
        />
        <Stat
          label="本年"
          value={fmtBytes(a.year.rx + a.year.tx)}
          sub={`↓ ${fmtBytes(a.year.rx)} ↑ ${fmtBytes(a.year.tx)}`}
        />
        <Stat
          label="累计"
          value={fmtBytes(a.total.rx + a.total.tx)}
          sub={`↓ ${fmtBytes(a.total.rx)} ↑ ${fmtBytes(a.total.tx)}`}
        />
        <Stat
          label={`本周期（${MODE_LABEL[b.mode] ?? b.mode}，${b.reset_day} 日重置）`}
          value={fmtBytes(a.period.used)}
          sub={
            a.period.quota > 0
              ? `${a.period.pct.toFixed(1)}% / ${fmtBytes(a.period.quota, 0)}，${fmtDate(a.period.start)} 起`
              : `不限量，${fmtDate(a.period.start)} 起`
          }
          pct={a.period.quota > 0 ? a.period.pct : undefined}
        />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
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
      </div>
      {bars.length > 0 && (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-muted-foreground select-none">
            数据表
          </summary>
          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH className="text-right">下载</TH>
                <TH className="text-right">上传</TH>
                <TH className="text-right">合计</TH>
              </TR>
            </THead>
            <TBody>
              {[...bars].reverse().map((r) => (
                <TR key={r.full} className="tnum">
                  <TD>{r.full}</TD>
                  <TD className="text-right">{fmtBytes(r.rx)}</TD>
                  <TD className="text-right">{fmtBytes(r.tx)}</TD>
                  <TD className="text-right">{fmtBytes(r.rx + r.tx)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </details>
      )}
    </Section>
  );
}

function LatencyPanel({ a, targets }: { a: AgentView; targets: Target[] }) {
  const [range, setRange] = useState<RangeKey>("24h");
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
  return (
    <Section
      title="延迟"
      aside={
        <Segmented
          ariaLabel="延迟时间范围"
          value={range}
          onChange={setRange}
          options={rangeOptions.map((r) => ({ value: r.value, label: r.label }))}
        />
      }
    >
      {mine.length === 0 ? (
        <Empty>还没有给这台服务器分配延迟监测目标。</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <LossLegend />
          <div
            className={`grid gap-3 lg:grid-cols-2 ${res.loading ? "opacity-60" : ""} transition-opacity`}
          >
            {mine.map((t) => (
              <div key={t.id} className="rounded-lg border bg-card p-3">
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
        </div>
      )}
    </Section>
  );
}

function MetricsPanel({ a }: { a: AgentView }) {
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
        className={`grid gap-3 md:grid-cols-3 ${rows.loading ? "opacity-60" : ""} transition-opacity`}
      >
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-1 px-1 text-sm font-medium">CPU</div>
          <PercentLine rows={data} field="cpu" label="CPU" from={from} to={to} />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-1 px-1 text-sm font-medium">内存</div>
          <PercentLine rows={data} field="mem" label="内存" from={from} to={to} />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-sm font-medium">网速</span>
            <TrafficLegend />
          </div>
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
  const mem = a.mem_total ? (100 * a.mem_used) / a.mem_total : 0;
  const disk = a.disk_total ? (100 * a.disk_used) / a.disk_total : 0;
  const b = a.billing;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← 全部服务器
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Flag code={a.country} className="h-[18px] w-6" />
          <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
          <StatusPill a={a} />
          <ExpiryPill a={a} />
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            a.note,
            a.hostname,
            a.os,
            a.kernel && `内核 ${a.kernel}`,
            a.arch && `${a.arch}${a.cpus ? ` ${a.cpus} 核` : ""}`,
            a.online && `已运行 ${fmtDuration(a.uptime)}`,
            a.tz && `时区 ${a.tz}`,
          ]
            .filter(Boolean)
            .join("，")}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 md:grid-cols-4">
        <Stat
          label="CPU"
          value={a.online ? `${a.cpu.toFixed(0)}%` : "—"}
          sub={a.online ? `负载 ${a.load.map((l) => l.toFixed(2)).join(" / ")}` : undefined}
          pct={a.online ? a.cpu : undefined}
        />
        <Stat
          label="内存"
          value={a.online ? `${mem.toFixed(0)}%` : "—"}
          sub={
            a.online
              ? `${fmtBytes(a.mem_used)} / ${fmtBytes(a.mem_total)}${a.swap_total ? `，交换 ${fmtBytes(a.swap_used)} / ${fmtBytes(a.swap_total)}` : ""}`
              : undefined
          }
          pct={a.online ? mem : undefined}
        />
        <Stat
          label="磁盘"
          value={a.online ? `${disk.toFixed(0)}%` : "—"}
          sub={a.online ? `${fmtBytes(a.disk_used)} / ${fmtBytes(a.disk_total)}` : undefined}
          pct={a.online ? disk : undefined}
        />
        <Stat
          label={`网速${a.iface ? `（${a.iface}）` : ""}`}
          value={a.online ? `↓ ${fmtRate(a.rx_rate)}` : "—"}
          sub={a.online ? `↑ ${fmtRate(a.tx_rate)}` : undefined}
        />
      </div>

      <TrafficPanel a={a} />
      <LatencyPanel a={a} targets={targets.data ?? []} />
      <MetricsPanel a={a} />

      {b.cycle !== "free" && (
        <Section title="付费">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">周期</dt>
              <dd>{b.cycle === "custom" ? `每 ${b.days} 天` : CYCLE_LABEL[b.cycle]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">价格</dt>
              <dd>{b.price > 0 ? fmtMoney(b.price, b.currency) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">到期</dt>
              <dd>
                {b.expires_at || "—"}
                {b.auto_renew && b.expires_at ? "（自动续期）" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">流量</dt>
              <dd>
                {b.quota > 0 ? fmtBytes(b.quota, 0) : "不限"}，{MODE_LABEL[b.mode] ?? b.mode}，每月{" "}
                {b.reset_day} 日重置
              </dd>
            </div>
          </dl>
        </Section>
      )}
    </div>
  );
}

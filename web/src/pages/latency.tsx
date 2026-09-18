import { useEffect, useState } from "react";
import { Link } from "react-router";
import { COMPARE_MAX, CompareChart, compareItems } from "@/components/charts/compare-chart";
import { LossLegend, SmokeChart } from "@/components/charts/smoke-chart";
import { Flag } from "@/components/flag";
import { StatusDot } from "@/components/status";
import { Empty, Segmented } from "@/components/ui/table";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";
import type { AgentView, PingResponse, Target } from "@/types";
import { type RangeKey, rangeOptions, useWindow } from "./server";

type View = "smoke" | "compare";

/** One target at a time: every server probing it, as small multiples or overlaid. */
export function LatencyPage() {
  const targets = usePoll(() => api.get<Target[]>("/api/v1/targets"), 60000);
  const agents = usePoll(() => api.get<AgentView[]>("/api/v1/agents"), 30000);
  const [targetID, setTargetID] = useState("");
  const [range, setRange] = useState<RangeKey>("24h");
  const [view, setView] = useState<View>("smoke");
  const win = useWindow(range);

  const list = targets.data ?? [];
  useEffect(() => {
    if (!targetID && list.length > 0) setTargetID(list[0].id);
  }, [list, targetID]);

  const res = usePoll<PingResponse | undefined>(
    () =>
      targetID
        ? api.get<PingResponse>(`/api/v1/ping?target=${targetID}&from=${win.from}&to=${win.to}`)
        : Promise.resolve(undefined),
    60000,
    [targetID, win.from, win.to],
  );

  const target = list.find((t) => t.id === targetID);
  const probing = (agents.data ?? []).filter(
    (a) => target && (target.agent_ids.length === 0 || target.agent_ids.includes(a.id)),
  );
  const rawStep =
    target && res.data?.tier === "ping_raw" ? target.interval : (res.data?.step ?? win.step);
  const { items, truncated } = compareItems(
    probing,
    (a) => a.id,
    (a) => a.name,
    (a) => res.data?.series.find((s) => s.agent_id === a.id),
  );

  if (targets.data && list.length === 0) {
    return <Empty>还没有延迟监测目标。登录后台添加一个，例如某个机房的 443 端口。</Empty>;
  }
  return (
    <div className="rounded-lg border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5">
        <h1 className="text-sm font-semibold">延迟对比</h1>
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
            ariaLabel="时间范围"
            value={range}
            onChange={setRange}
            options={rangeOptions.map((r) => ({ value: r.value, label: r.label }))}
          />
        </div>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        <Segmented
          ariaLabel="监测目标"
          value={targetID}
          onChange={setTargetID}
          options={list.map((t) => ({ value: t.id, label: t.name }))}
        />
        <div
          className={`flex flex-col gap-3 ${res.loading ? "opacity-60" : ""} transition-opacity`}
        >
          {view === "smoke" ? (
            <>
              <LossLegend />
              <div className="grid gap-4 xl:grid-cols-2">
                {probing.map((a) => (
                  <div key={a.id}>
                    <div className="mb-1 flex items-baseline justify-between px-1">
                      <Link
                        to={`/servers/${a.id}`}
                        className="flex items-center gap-2 text-sm font-medium hover:underline"
                      >
                        <Flag code={a.country} />
                        {a.name}
                        <StatusDot tone={a.online ? "ok" : "crit"} className="size-2" />
                      </Link>
                      <span className="text-xs text-muted-foreground">毫秒</span>
                    </div>
                    <SmokeChart
                      series={res.data?.series.find((s) => s.agent_id === a.id)}
                      from={win.from}
                      to={win.to}
                      step={rawStep}
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
              step={rawStep}
              height={280}
              hint={
                <>
                  毫秒 · 丢包为整个时间窗的合计 · 点击图例显示或隐藏
                  {truncated > 0 && ` · 只画前 ${COMPARE_MAX} 台服务器，其余见烟雾图`}
                </>
              }
            />
          )}
        </div>
        {target && probing.length === 0 && <Empty>没有服务器在监测这个目标。</Empty>}
      </div>
    </div>
  );
}

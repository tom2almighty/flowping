import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LossLegend, SmokeChart } from "@/components/charts/smoke-chart";
import { Flag } from "@/components/flag";
import { Empty, Segmented } from "@/components/ui/table";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";
import type { AgentView, PingResponse, Target } from "@/types";
import { type RangeKey, rangeOptions, useWindow } from "./server";

/** One target at a time, every server that probes it as a small multiple. */
export function LatencyPage() {
  const targets = usePoll(() => api.get<Target[]>("/api/v1/targets"), 60000);
  const agents = usePoll(() => api.get<AgentView[]>("/api/v1/agents"), 30000);
  const [targetID, setTargetID] = useState("");
  const [range, setRange] = useState<RangeKey>("24h");
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
  const step = (() => {
    const d = res.data;
    if (!d) return win.step;
    return d.tier === "ping_raw" && target ? target.interval : d.step;
  })();

  if (targets.data && list.length === 0) {
    return <Empty>还没有延迟监测目标。登录后台添加一个，例如某个机房的 443 端口。</Empty>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="监测目标"
          value={targetID}
          onChange={setTargetID}
          options={list.map((t) => ({ value: t.id, label: t.name }))}
        />
        <div className="ml-auto">
          <Segmented
            ariaLabel="时间范围"
            value={range}
            onChange={setRange}
            options={rangeOptions.map((r) => ({ value: r.value, label: r.label }))}
          />
        </div>
      </div>
      <LossLegend />
      <div
        className={`grid gap-3 lg:grid-cols-2 ${res.loading ? "opacity-60" : ""} transition-opacity`}
      >
        {probing.map((a) => (
          <div key={a.id} className="rounded-lg border bg-card p-3">
            <div className="mb-1 flex items-baseline justify-between px-1">
              <Link
                to={`/servers/${a.id}`}
                className="flex items-center gap-2 text-sm font-medium hover:underline"
              >
                <Flag code={a.country} />
                {a.name}
              </Link>
              <span className="text-xs text-muted-foreground">毫秒</span>
            </div>
            <SmokeChart
              series={res.data?.series.find((s) => s.agent_id === a.id)}
              from={win.from}
              to={win.to}
              step={step}
            />
          </div>
        ))}
      </div>
      {target && probing.length === 0 && <Empty>没有服务器在监测这个目标。</Empty>}
    </div>
  );
}

import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Pill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDragOrder } from "@/lib/use-drag-order";
import { usePoll } from "@/lib/use-poll";
import type { AdminAgent, AdminTarget } from "@/types";
import { ErrorText, PageTitle, useAction } from "./common";

interface Form {
  name: string;
  host: string;
  port: number;
  interval: number;
  count: number;
  timeout_ms: number;
  all_agents: boolean;
  agent_ids: string[];
  enabled: boolean;
  sort_order: number;
}

function toForm(t?: AdminTarget): Form {
  return t
    ? { ...t }
    : {
        name: "",
        host: "",
        port: 443,
        interval: 60,
        count: 20,
        timeout_ms: 2000,
        all_agents: true,
        agent_ids: [],
        enabled: true,
        sort_order: 0,
      };
}

function TargetForm({
  initial,
  agents,
  onSaved,
  onClose,
}: {
  initial?: AdminTarget;
  agents: AdminAgent[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const { busy, error, run } = useAction();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const toggleAgent = (id: string) =>
    set(
      "agent_ids",
      f.agent_ids.includes(id) ? f.agent_ids.filter((x) => x !== id) : [...f.agent_ids, id],
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (initial) await api.put(`/api/v1/admin/targets/${initial.id}`, f);
      else await api.post("/api/v1/admin/targets", f);
      onSaved();
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_90px]">
        <Field label="名称" help="留空则用主机名">
          <Input
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="东京 CF"
            autoFocus
          />
        </Field>
        <Field label="主机">
          <Input
            value={f.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="1.1.1.1 或域名"
            required
          />
        </Field>
        <Field label="端口">
          <Input
            type="number"
            min={1}
            max={65535}
            value={f.port}
            onChange={(e) => set("port", Number(e.target.value))}
            required
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="周期（秒）" help="每个周期发一组探测">
          <Input
            type="number"
            min={10}
            max={3600}
            value={f.interval}
            onChange={(e) => set("interval", Number(e.target.value))}
          />
        </Field>
        <Field label="每周期探测次数">
          <Input
            type="number"
            min={1}
            max={100}
            value={f.count}
            onChange={(e) => set("count", Number(e.target.value))}
          />
        </Field>
        <Field label="超时（毫秒）">
          <Input
            type="number"
            min={100}
            max={10000}
            value={f.timeout_ms}
            onChange={(e) => set("timeout_ms", Number(e.target.value))}
          />
        </Field>
      </div>
      <SwitchField label="启用" checked={f.enabled} onCheckedChange={(v) => set("enabled", v)} />
      <SwitchField
        label="所有服务器都监测"
        checked={f.all_agents}
        onCheckedChange={(v) => set("all_agents", v)}
      />
      {!f.all_agents && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            选择监测的服务器
            {f.agent_ids.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                已选 {f.agent_ids.length} 台
              </span>
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {agents.map((a) => {
              const on = f.agent_ids.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAgent(a.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? "border-foreground/40 bg-nav-active text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {a.name}
                </button>
              );
            })}
            {agents.length === 0 && (
              <span className="text-xs text-muted-foreground">还没有服务器</span>
            )}
          </div>
          {agents.length > 0 && f.agent_ids.length === 0 && (
            <p className="text-xs text-crit">没有选择任何服务器，这个目标不会被探测。</p>
          )}
        </div>
      )}
      <ErrorText text={error} />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={busy}>
          {initial ? "保存" : "添加"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TargetsAdmin() {
  const list = usePoll(() => api.get<AdminTarget[]>("/api/v1/admin/targets"), 0);
  const agents = usePoll(() => api.get<AdminAgent[]>("/api/v1/admin/agents"), 0);
  const [editing, setEditing] = useState<AdminTarget | "new" | null>(null);
  const { error, run } = useAction();
  const agentName = new Map((agents.data ?? []).map((a) => [a.id, a.name]));

  const ids = (list.data ?? []).map((t) => t.id);
  const { rowProps, move, edge } = useDragOrder(ids, (next) =>
    run(async () => {
      await api.post("/api/v1/admin/targets/reorder", { ids: next });
      list.reload();
    }),
  );

  const remove = (t: AdminTarget) => {
    if (!confirm(`删除 ${t.name}？它的延迟历史会一起删除。`)) return;
    run(async () => {
      await api.del(`/api/v1/admin/targets/${t.id}`);
      list.reload();
    });
  };

  return (
    <div>
      <PageTitle title="延迟监测目标">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          添加目标
        </Button>
      </PageTitle>
      <ErrorText text={error} />
      {list.data && list.data.length === 0 ? (
        <Empty>目标是一个主机加 TCP 端口，每台服务器会定期对它做一组连接测试并画成延迟图。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH className="text-left">名称</TH>
                <TH>地址</TH>
                <TH>探测</TH>
                <TH>监测的服务器</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {(list.data ?? []).map((t) => (
                <TR key={t.id} {...rowProps(t.id)} className={t.enabled ? undefined : "opacity-60"}>
                  <TD className="text-left">
                    <div className="flex items-center gap-2">
                      <GripVerticalIcon
                        className="size-4 shrink-0 text-muted-foreground/50"
                        aria-hidden
                      />
                      <span className="font-medium">{t.name}</span>
                      {!t.enabled && (
                        <Pill tone="offline" dot={false}>
                          已停用
                        </Pill>
                      )}
                    </div>
                  </TD>
                  <TD className="tnum">
                    {t.host}:{t.port}
                  </TD>
                  <TD className="text-muted-foreground tnum">
                    每 {t.interval}s × {t.count}，超时 {t.timeout_ms}ms
                  </TD>
                  <TD className="text-muted-foreground">
                    {t.all_agents
                      ? "全部"
                      : t.agent_ids.map((id) => agentName.get(id) ?? id).join("、") || "无"}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="上移"
                        disabled={edge(t.id).first}
                        onClick={() => move(t.id, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="下移"
                        disabled={edge(t.id).last}
                        onClick={() => move(t.id, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="编辑"
                        onClick={() => setEditing(t)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(t)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="px-5 pb-4 text-xs text-muted-foreground">
            拖动行可调整顺序，前台延迟页和每一行的延迟徽章都按这个顺序显示。
          </p>
        </div>
      )}
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent
            title={editing === "new" ? "添加目标" : `编辑 ${editing.name}`}
            className="max-w-xl"
          >
            <TargetForm
              initial={editing === "new" ? undefined : editing}
              agents={agents.data ?? []}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                list.reload();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

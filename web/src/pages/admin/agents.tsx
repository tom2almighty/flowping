import { PlusIcon, RefreshCwIcon, TerminalIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Flag } from "@/components/flag";
import { Pill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { CYCLE_LABEL, fmtAgo, fmtBytes, MODE_LABEL } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { AdminAgent, Billing } from "@/types";
import { CopyBlock, ErrorText, PageTitle, useAction } from "./common";

const GiB = 1024 ** 3;

const emptyBilling: Billing = {
  cycle: "free",
  days: 30,
  price: 0,
  currency: "USD",
  expires_at: "",
  auto_renew: false,
  quota: 0,
  reset_day: 1,
  mode: "both",
};

interface Form {
  name: string;
  note: string;
  country: string;
  iface: string;
  interval: number;
  sort_order: number;
  hidden: boolean;
  billing: Billing;
}

function toForm(a?: AdminAgent): Form {
  return a
    ? {
        name: a.name,
        note: a.note,
        country: a.country,
        iface: a.iface,
        interval: a.interval,
        sort_order: a.sort_order,
        hidden: a.hidden,
        billing: { ...a.billing },
      }
    : {
        name: "",
        note: "",
        country: "",
        iface: "",
        interval: 3,
        sort_order: 0,
        hidden: false,
        billing: { ...emptyBilling },
      };
}

function AgentForm({
  initial,
  onSaved,
  onClose,
}: {
  initial?: AdminAgent;
  onSaved: (a: AdminAgent) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const { busy, error, run } = useAction();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const setB = <K extends keyof Billing>(k: K, v: Billing[K]) =>
    setF({ ...f, billing: { ...f.billing, [k]: v } });
  const b = f.billing;
  const paid = b.cycle !== "free";
  const recurring = paid && b.cycle !== "lifetime";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const saved = initial
        ? await api.put<AdminAgent>(`/api/v1/admin/agents/${initial.id}`, f)
        : await api.post<AdminAgent>("/api/v1/admin/agents", f);
      onSaved(saved);
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名称">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} required autoFocus />
        </Field>
        <Field label="国家/地区代码" help="留空则按上报 IP 自动识别">
          <Input
            value={f.country}
            onChange={(e) => set("country", e.target.value)}
            placeholder="如 jp、us、hk"
            maxLength={2}
          />
        </Field>
      </div>
      <Field label="备注">
        <Textarea
          value={f.note}
          onChange={(e) => set("note", e.target.value)}
          className="min-h-14"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="上报间隔（秒）">
          <Input
            type="number"
            min={1}
            max={300}
            value={f.interval}
            onChange={(e) => set("interval", Number(e.target.value))}
          />
        </Field>
        <Field label="统计网卡" help="留空自动选默认路由网卡">
          <Input
            value={f.iface}
            onChange={(e) => set("iface", e.target.value)}
            placeholder="eth0"
          />
        </Field>
        <Field label="排序">
          <Input
            type="number"
            value={f.sort_order}
            onChange={(e) => set("sort_order", Number(e.target.value))}
          />
        </Field>
      </div>
      <SwitchField
        label="对外隐藏"
        help="只有登录后才能看到这台服务器"
        checked={f.hidden}
        onCheckedChange={(v) => set("hidden", v)}
      />

      <div className="border-t pt-4">
        <p className="mb-3 text-sm font-medium">付费</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="付费周期">
            <Select value={b.cycle} onChange={(e) => setB("cycle", e.target.value)}>
              {Object.entries(CYCLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {b.cycle === "custom" && (
            <Field label="周期天数">
              <Input
                type="number"
                min={1}
                value={b.days}
                onChange={(e) => setB("days", Number(e.target.value))}
              />
            </Field>
          )}
          {paid && (
            <>
              <Field label="价格">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={b.price}
                  onChange={(e) => setB("price", Number(e.target.value))}
                />
              </Field>
              <Field label="币种">
                <Input
                  value={b.currency}
                  onChange={(e) => setB("currency", e.target.value.toUpperCase())}
                  maxLength={5}
                />
              </Field>
            </>
          )}
          {recurring && (
            <>
              <Field label="到期日期">
                <Input
                  type="date"
                  value={b.expires_at}
                  onChange={(e) => setB("expires_at", e.target.value)}
                />
              </Field>
              <div className="flex items-end pb-1 sm:col-span-2">
                <SwitchField
                  label="到期后自动顺延一个周期"
                  checked={b.auto_renew}
                  onCheckedChange={(v) => setB("auto_renew", v)}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="mb-3 text-sm font-medium">流量</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="每周期配额（GiB）" help="0 为不限">
            <Input
              type="number"
              min={0}
              step="1"
              value={Math.round((b.quota / GiB) * 100) / 100}
              onChange={(e) => setB("quota", Math.round(Number(e.target.value) * GiB))}
            />
          </Field>
          <Field label="计费方式">
            <Select value={b.mode} onChange={(e) => setB("mode", e.target.value)}>
              {Object.entries(MODE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="每月重置日">
            <Input
              type="number"
              min={1}
              max={31}
              value={b.reset_day}
              onChange={(e) => setB("reset_day", Number(e.target.value))}
            />
          </Field>
        </div>
      </div>

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

function InstallDialog({ agent, onClose }: { agent: AdminAgent; onClose: () => void }) {
  const cmds = usePoll(
    () =>
      api.get<{ shell: string; docker: string; compose: string }>(
        `/api/v1/admin/agents/${agent.id}/install`,
      ),
    0,
    [agent.token],
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`部署 ${agent.name}`}
        description="在目标服务器上以 root 执行其中一种。"
        className="max-w-2xl"
      >
        {cmds.data && (
          <div className="flex flex-col gap-4">
            <CopyBlock label="二进制 + systemd" text={cmds.data.shell} />
            <CopyBlock label="Docker" text={cmds.data.docker} />
            <CopyBlock label="Docker Compose" text={cmds.data.compose} />
            <p className="text-xs text-muted-foreground">
              Docker 方式必须使用 host 网络与 host PID，并把根目录只读挂载到
              /host，否则读到的是容器自己的数据。
            </p>
          </div>
        )}
        {cmds.error && <ErrorText text={cmds.error.message} />}
      </DialogContent>
    </Dialog>
  );
}

export function AgentsAdmin() {
  const list = usePoll(() => api.get<AdminAgent[]>("/api/v1/admin/agents"), 15000);
  const [editing, setEditing] = useState<AdminAgent | "new" | null>(null);
  const [installing, setInstalling] = useState<AdminAgent | null>(null);
  const { error, run } = useAction();

  const remove = (a: AdminAgent) => {
    if (!confirm(`删除 ${a.name}？它的所有流量和延迟历史会一起删除。`)) return;
    run(async () => {
      await api.del(`/api/v1/admin/agents/${a.id}`);
      list.reload();
    });
  };
  const rotate = (a: AdminAgent) => {
    if (!confirm(`重置 ${a.name} 的令牌？旧令牌立即失效，需要重新部署 agent。`)) return;
    run(async () => {
      const updated = await api.post<AdminAgent>(`/api/v1/admin/agents/${a.id}/rotate-token`);
      list.reload();
      setInstalling(updated);
    });
  };

  return (
    <div>
      <PageTitle title="服务器">
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          添加服务器
        </Button>
      </PageTitle>
      <ErrorText text={error} />
      {list.data && list.data.length === 0 ? (
        <Empty>添加一台服务器后，这里会给出一键部署命令。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>名称</TH>
                <TH>最后上报</TH>
                <TH>IP</TH>
                <TH>付费</TH>
                <TH>流量配额</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {(list.data ?? []).map((a) => (
                <TR key={a.id}>
                  <TD>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left font-medium hover:underline"
                      onClick={() => setEditing(a)}
                    >
                      <Flag code={a.country} />
                      {a.name}
                      {a.hidden && (
                        <Pill tone="offline" dot={false}>
                          隐藏
                        </Pill>
                      )}
                    </button>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                  </TD>
                  <TD className="text-muted-foreground">
                    {a.last_seen ? fmtAgo(a.last_seen) : <Pill tone="offline">未上报</Pill>}
                    {a.agent_version && <div className="text-xs">{a.agent_version}</div>}
                  </TD>
                  <TD className="tnum text-muted-foreground">{a.ip || "—"}</TD>
                  <TD className="text-muted-foreground">
                    {CYCLE_LABEL[a.billing.cycle]}
                    {a.billing.expires_at && (
                      <div className="text-xs tnum">{a.billing.expires_at}</div>
                    )}
                  </TD>
                  <TD className="text-muted-foreground tnum">
                    {a.billing.quota > 0 ? fmtBytes(a.billing.quota, 0) : "不限"}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="部署命令"
                        onClick={() => setInstalling(a)}
                      >
                        <TerminalIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="重置令牌"
                        onClick={() => rotate(a)}
                      >
                        <RefreshCwIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(a)}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent
            title={editing === "new" ? "添加服务器" : `编辑 ${editing.name}`}
            className="max-w-2xl"
          >
            <AgentForm
              initial={editing === "new" ? undefined : editing}
              onClose={() => setEditing(null)}
              onSaved={(a) => {
                setEditing(null);
                list.reload();
                if (editing === "new") setInstalling(a);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {installing && <InstallDialog agent={installing} onClose={() => setInstalling(null)} />}
    </div>
  );
}

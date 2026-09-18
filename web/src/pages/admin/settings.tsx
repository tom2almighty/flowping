import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { usePoll } from "@/lib/use-poll";
import type { Settings } from "@/types";
import { ErrorText, Group, PageTitle, useAction } from "./common";
import { GeoipGroup } from "./geoip";
import { MaintenanceGroup } from "./maintenance";

/** One threshold: label on the left, a narrow input and its unit on the right. */
function NumRow({
  s,
  k,
  label,
  unit,
  set,
}: {
  s: Settings;
  k: string;
  label: string;
  unit: string;
  set: (k: string, v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="min-w-0">
        {label}
      </label>
      <span className="flex shrink-0 items-center gap-1.5">
        <Input
          id={id}
          type="number"
          min={0}
          value={s[k] ?? ""}
          onChange={(e) => set(k, e.target.value)}
          className="h-8 w-20 text-right"
        />
        <span className="w-7 text-xs text-muted-foreground">{unit}</span>
      </span>
    </div>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs font-medium text-muted-foreground">{children}</p>;
}

export function SettingsAdmin() {
  const remote = usePoll(() => api.get<Settings>("/api/v1/admin/settings"), 0);
  const { reload: reloadSite } = useSite();
  const [s, setS] = useState<Settings>({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (remote.data) setS(remote.data);
  }, [remote.data]);
  const set = (k: string, v: string) => {
    setSaved(false);
    setS((cur) => ({ ...cur, [k]: v }));
  };
  const save = () =>
    run(async () => {
      const out = await api.put<Settings>("/api/v1/admin/settings", s);
      setS(out);
      setSaved(true);
      reloadSite();
    });

  const pw = useAction();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwDone, setPwDone] = useState(false);
  const changePw = (e: FormEvent) => {
    e.preventDefault();
    pw.run(async () => {
      await api.post("/api/v1/admin/password", { current: cur, new: next });
      setCur("");
      setNext("");
      setPwDone(true);
    });
  };

  if (!remote.data) return remote.error ? <ErrorText text={remote.error.message} /> : null;
  return (
    <div>
      <PageTitle title="设置">
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-ok">已保存</span>}
          <Button onClick={save} disabled={busy}>
            保存设置
          </Button>
        </div>
      </PageTitle>
      <ErrorText text={error} />
      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Group title="站点">
          <Field label="站点名称">
            <Input value={s.site_name ?? ""} onChange={(e) => set("site_name", e.target.value)} />
          </Field>
          <SwitchField
            label="公开访问"
            help="关闭后只有登录用户或持 API 令牌的调用能读取数据"
            checked={s.public === "true"}
            onCheckedChange={(v) => set("public", String(v))}
          />
          <Field
            label="允许 GitHub 登录的用户名"
            help="逗号分隔；需要在 hub 环境变量里配置 OAuth 应用"
          >
            <Input
              value={s.github_users ?? ""}
              onChange={(e) => set("github_users", e.target.value)}
              placeholder="octocat, another"
            />
          </Field>
          <Field label="主题市场地址" help="一个返回主题列表的 index.json">
            <Input
              value={s.theme_market_url ?? ""}
              onChange={(e) => set("theme_market_url", e.target.value)}
            />
          </Field>
        </Group>

        <Group title="通知阈值">
          <p className="text-xs text-muted-foreground">阈值为 0 表示不提醒该项。</p>
          <SubTitle>上下线</SubTitle>
          <SwitchField
            label="上线/离线通知"
            checked={s.notify_offline === "true"}
            onCheckedChange={(v) => set("notify_offline", String(v))}
          />
          <NumRow s={s} k="offline_grace" label="离线判定" unit="秒" set={set} />

          <SubTitle>资源占用</SubTitle>
          <NumRow s={s} k="cpu_pct" label="CPU 使用率" unit="%" set={set} />
          <NumRow s={s} k="mem_pct" label="内存使用率" unit="%" set={set} />
          <NumRow s={s} k="disk_pct" label="硬盘使用率" unit="%" set={set} />
          <NumRow s={s} k="load_grace" label="超阈值持续" unit="秒" set={set} />

          <SubTitle>延迟与丢包</SubTitle>
          <NumRow s={s} k="loss_pct" label="丢包率" unit="%" set={set} />
          <NumRow s={s} k="latency_ms" label="中位延迟" unit="毫秒" set={set} />
          <NumRow s={s} k="ping_grace" label="超阈值持续" unit="秒" set={set} />

          <SubTitle>计费</SubTitle>
          <NumRow s={s} k="traffic_pct" label="流量配额用量" unit="%" set={set} />
          <NumRow s={s} k="expire_days" label="到期前提醒" unit="天" set={set} />
        </Group>

        <GeoipGroup s={s} set={set} />

        <MaintenanceGroup />

        <Group title="管理员密码">
          <form onSubmit={changePw} className="flex flex-col gap-3">
            <Field label="当前密码">
              <Input
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                required
              />
            </Field>
            <Field label="新密码" help="至少 8 位">
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            <ErrorText text={pw.error} />
            {pwDone && <p className="text-sm text-ok">密码已更新</p>}
            <div>
              <Button type="submit" variant="outline" disabled={pw.busy}>
                修改密码
              </Button>
            </div>
          </form>
        </Group>
      </div>
    </div>
  );
}

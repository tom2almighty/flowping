import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { usePoll } from "@/lib/use-poll";
import type { Settings } from "@/types";
import { ErrorText, Group, PageTitle, useAction } from "./common";
import { GeoipGroup } from "./geoip";

function Num({
  s,
  k,
  label,
  help,
  set,
}: {
  s: Settings;
  k: string;
  label: string;
  help?: string;
  set: (k: string, v: string) => void;
}) {
  return (
    <Field label={label} help={help}>
      <Input
        type="number"
        value={s[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        className="max-w-40"
      />
    </Field>
  );
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
      <div className="grid gap-4 lg:grid-cols-2">
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

        <GeoipGroup s={s} set={set} />

        <Group title="通知阈值">
          <SwitchField
            label="上线/离线通知"
            checked={s.notify_offline === "true"}
            onCheckedChange={(v) => set("notify_offline", String(v))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Num
              s={s}
              k="offline_grace"
              label="离线判定（秒）"
              help="超过这么久没上报视为离线"
              set={set}
            />
            <Num
              s={s}
              k="load_grace"
              label="资源持续（秒）"
              help="CPU/内存/磁盘超阈值持续多久才通知"
              set={set}
            />
            <Num s={s} k="cpu_pct" label="CPU（%）" help="0 关闭" set={set} />
            <Num s={s} k="mem_pct" label="内存（%）" help="0 关闭" set={set} />
            <Num s={s} k="disk_pct" label="磁盘（%）" help="0 关闭" set={set} />
            <Num
              s={s}
              k="ping_grace"
              label="延迟持续（秒）"
              help="丢包/延迟超阈值持续多久才通知"
              set={set}
            />
            <Num s={s} k="loss_pct" label="丢包（%）" help="0 关闭" set={set} />
            <Num s={s} k="latency_ms" label="中位延迟（毫秒）" help="0 关闭" set={set} />
            <Num s={s} k="traffic_pct" label="流量配额（%）" help="0 关闭" set={set} />
            <Num s={s} k="expire_days" label="到期前提醒（天）" help="0 关闭" set={set} />
          </div>
        </Group>

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

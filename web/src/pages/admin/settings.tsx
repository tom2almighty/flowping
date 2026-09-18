import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SwitchField } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { usePoll } from "@/lib/use-poll";
import type { Settings } from "@/types";
import { ErrorText, PageTitle, Section, useAction } from "./common";
import { GeoipSection } from "./geoip";
import { MaintenanceSection } from "./maintenance";

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

/** Threshold lists read as a short two-column table, so they stay narrow. */
const thresholds = "max-w-xs gap-2";

export function SettingsAdmin() {
  const remote = usePoll(() => api.get<Settings>("/api/v1/admin/settings"), 0);
  const { reload: reloadSite } = useSite();
  const [base, setBase] = useState<Settings>({});
  const [s, setS] = useState<Settings>({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const dirty = useMemo(
    () => Object.keys({ ...base, ...s }).some((k) => (s[k] ?? "") !== (base[k] ?? "")),
    [s, base],
  );
  // The poll refetches when the tab regains focus; that must not wipe edits.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!remote.data) return;
    setBase(remote.data);
    if (!dirtyRef.current) setS(remote.data);
  }, [remote.data]);
  const set = (k: string, v: string) => {
    setSaved(false);
    setS((cur) => ({ ...cur, [k]: v }));
  };
  // Also used by the GeoIP download, which needs the URL on screen persisted first.
  const persist = async () => {
    const out = await api.put<Settings>("/api/v1/admin/settings", s);
    setBase(out);
    setS(out);
    setSaved(true);
    reloadSite();
  };
  const save = () => run(persist);

  const pw = useAction();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwDone, setPwDone] = useState(false);
  const changePw = (e: FormEvent) => {
    e.preventDefault();
    setPwDone(false);
    pw.run(async () => {
      await api.post("/api/v1/admin/password", { current: cur, new: next });
      setCur("");
      setNext("");
      setPwDone(true);
    });
  };

  if (!remote.data) return remote.error ? <ErrorText text={remote.error.message} /> : null;
  return (
    <div className="max-w-4xl">
      <PageTitle title="设置" />

      {/* overflow-clip is not a scroll container, so the sticky footer still
          tracks the viewport while the card's corners clip it at rest. */}
      <div className="overflow-clip rounded-lg border bg-card">
        <Section
          title="站点"
          description="站点名称显示在页头和浏览器标签。关闭公开访问后，只有登录用户和持 API 令牌的调用能读取数据。"
        >
          <Field label="站点名称">
            <Input value={s.site_name ?? ""} onChange={(e) => set("site_name", e.target.value)} />
          </Field>
          <SwitchField
            label="公开访问"
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
        </Section>

        <Section
          title="上下线"
          description="超过判定时间没有上报的服务器视为离线。"
          className={thresholds}
        >
          <SwitchField
            label="上线/离线通知"
            checked={s.notify_offline === "true"}
            onCheckedChange={(v) => set("notify_offline", String(v))}
          />
          <NumRow s={s} k="offline_grace" label="离线判定" unit="秒" set={set} />
        </Section>

        <Section
          title="资源占用"
          description="CPU、内存或硬盘使用率超过阈值并持续这么久后通知。填 0 表示不提醒该项。"
          className={thresholds}
        >
          <NumRow s={s} k="cpu_pct" label="CPU 使用率" unit="%" set={set} />
          <NumRow s={s} k="mem_pct" label="内存使用率" unit="%" set={set} />
          <NumRow s={s} k="disk_pct" label="硬盘使用率" unit="%" set={set} />
          <NumRow s={s} k="load_grace" label="超阈值持续" unit="秒" set={set} />
        </Section>

        <Section
          title="延迟与丢包"
          description="丢包率或中位延迟超过阈值并持续这么久后通知。填 0 表示不提醒该项。"
          className={thresholds}
        >
          <NumRow s={s} k="loss_pct" label="丢包率" unit="%" set={set} />
          <NumRow s={s} k="latency_ms" label="中位延迟" unit="毫秒" set={set} />
          <NumRow s={s} k="ping_grace" label="超阈值持续" unit="秒" set={set} />
        </Section>

        <Section
          title="计费提醒"
          description="流量用到配额的这个比例，或距到期只剩这些天时提醒。填 0 表示不提醒该项。"
          className={thresholds}
        >
          <NumRow s={s} k="traffic_pct" label="流量配额用量" unit="%" set={set} />
          <NumRow s={s} k="expire_days" label="到期前提醒" unit="天" set={set} />
        </Section>

        <GeoipSection s={s} set={set} save={persist} />

        {/* Sticks to the viewport bottom while the card is on screen, so a long
            list of thresholds never puts the save button out of reach. */}
        <footer className="sticky bottom-0 flex items-center justify-end gap-4 border-t bg-card px-5 py-3">
          {error ? (
            <ErrorText text={error} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {dirty ? "有未保存的更改" : saved ? "已保存" : ""}
            </span>
          )}
          <Button onClick={save} disabled={busy || !dirty}>
            保存设置
          </Button>
        </footer>
      </div>

      <div className="mt-6 rounded-lg border bg-card">
        <MaintenanceSection />

        <Section title="管理员密码" description="密码登录使用这个密码，至少 8 位。">
          <form onSubmit={changePw} className="flex flex-col gap-4">
            <Field label="当前密码">
              <Input
                type="password"
                autoComplete="current-password"
                value={cur}
                onChange={(e) => setCur(e.target.value)}
                required
              />
            </Field>
            <Field label="新密码">
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={pw.busy}>
                修改密码
              </Button>
              {pw.error ? (
                <ErrorText text={pw.error} />
              ) : (
                pwDone && <span className="text-sm text-ok">密码已更新</span>
              )}
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}

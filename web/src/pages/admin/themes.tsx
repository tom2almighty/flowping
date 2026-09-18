import { CheckIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Empty } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { usePoll } from "@/lib/use-poll";
import type { ThemeMeta } from "@/types";
import { ErrorText, PageTitle, useAction } from "./common";

function ThemeCard({
  t,
  active,
  installed,
  onUse,
  onInstall,
  onRemove,
}: {
  t: ThemeMeta;
  active: boolean;
  installed: boolean;
  onUse?: () => void;
  onInstall?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border bg-card p-3 ${active ? "border-primary" : ""}`}
    >
      {t.preview && (
        <img
          src={t.preview}
          alt=""
          className="aspect-video w-full rounded-md object-cover"
          loading="lazy"
        />
      )}
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{t.title}</span>
        <span className="text-xs text-muted-foreground">
          {t.author && `${t.author} · `}
          {t.version}
        </span>
      </div>
      {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
      <div className="mt-auto flex gap-1 pt-1">
        {active ? (
          <span className="flex items-center gap-1 text-xs text-ok">
            <CheckIcon className="size-3.5" />
            使用中
          </span>
        ) : installed ? (
          <Button size="sm" variant="outline" onClick={onUse}>
            使用
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onInstall}>
            <DownloadIcon />
            安装
          </Button>
        )}
        {installed && !active && (
          <Button size="sm" variant="ghost" onClick={onRemove} title="删除">
            <Trash2Icon />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ThemesAdmin() {
  const { site, reload } = useSite();
  const installed = usePoll(() => api.get<ThemeMeta[]>("/api/v1/admin/themes"), 0);
  const market = usePoll(() => api.get<ThemeMeta[]>("/api/v1/admin/themes/market"), 0);
  const [url, setUrl] = useState("");
  const { busy, error, run } = useAction();
  const active = site?.theme ?? "";
  const have = new Set((installed.data ?? []).map((t) => t.name));

  const use = (name: string) =>
    run(async () => {
      await api.put("/api/v1/admin/settings", { theme: name });
      reload();
    });
  const install = (u: string) =>
    run(async () => {
      await api.post("/api/v1/admin/themes/install", { url: u });
      setUrl("");
      installed.reload();
    });
  const remove = (t: ThemeMeta) => {
    if (!confirm(`删除主题 ${t.title}？`)) return;
    run(async () => {
      await api.del(`/api/v1/admin/themes/${t.name}`);
      installed.reload();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle title="主题" />
        <p className="text-sm text-muted-foreground">
          主题只包含样式表、字体和图片，不会引入任何脚本。它覆盖页面的颜色变量，布局保持不变。
        </p>
      </div>
      <ErrorText text={error} />

      <section>
        <h2 className="mb-2 text-sm font-semibold">已安装</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ThemeCard
            t={{ name: "", title: "默认", author: "", version: "", description: "内置样式。" }}
            active={active === ""}
            installed
            onUse={() => use("")}
          />
          {(installed.data ?? []).map((t) => (
            <ThemeCard
              key={t.name}
              t={t}
              active={active === t.name}
              installed
              onUse={() => use(t.name)}
              onRemove={() => remove(t)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">主题市场</h2>
        {market.error ? (
          <Empty>{market.error.message}</Empty>
        ) : market.data && market.data.length === 0 ? (
          <Empty>市场里还没有主题。</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(market.data ?? []).map((t) => (
              <ThemeCard
                key={t.name}
                t={t}
                active={active === t.name}
                installed={have.has(t.name)}
                onUse={() => use(t.name)}
                onInstall={() => t.url && install(t.url)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">从地址安装</h2>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            install(url);
          }}
        >
          <Field
            label="主题 zip 地址"
            help="压缩包根目录需包含 theme.json 和 theme.css"
            className="flex-1"
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/theme.zip"
              required
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy}>
            安装
          </Button>
        </form>
      </section>
    </div>
  );
}

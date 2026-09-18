import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { GeoipStatus, Settings } from "@/types";
import { ErrorText, Group, useAction } from "./common";

/**
 * Country lookup for agents. The local database is exact and never sends an
 * agent address anywhere, but it is a file to keep fresh; the online lookup
 * needs nothing on disk.
 */
export function GeoipGroup({ s, set }: { s: Settings; set: (k: string, v: string) => void }) {
  const status = usePoll(() => api.get<GeoipStatus>("/api/v1/admin/geoip"), 0);
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const source = s.geoip_provider ?? "online";
  const st = status.data;

  // Saves first: the download has to use the URL that is on screen, not the one
  // that is still only in the settings table.
  const update = () =>
    run(async () => {
      setNote("");
      await api.put("/api/v1/admin/settings", s);
      const next = await api.post<GeoipStatus>("/api/v1/admin/geoip/update");
      status.reload();
      setNote(next.size > 0 ? `已更新，${fmtBytes(next.size)}` : "已更新");
    });

  return (
    <Group title="IP 归属地">
      <Field label="识别方式" help="留空国家代码时按上报 IP 识别；手工填过就不再覆盖">
        <Select value={source} onChange={(e) => set("geoip_provider", e.target.value)}>
          <option value="online">在线查询</option>
          <option value="mmdb">本地数据库</option>
          <option value="off">关闭</option>
        </Select>
      </Field>
      {source === "mmdb" && (
        <>
          <Field label="数据库下载地址" help="支持 .mmdb 与 .mmdb.gz，可换成 DB-IP 或自建镜像">
            <Input value={s.geoip_url ?? ""} onChange={(e) => set("geoip_url", e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={update} disabled={busy}>
              保存并更新数据库
            </Button>
            <span className="text-xs text-muted-foreground">
              {st?.error ? (
                <span className="text-crit">{st.error}</span>
              ) : st?.ready ? (
                <>
                  已就绪 · {fmtBytes(st.size)} · {fmtDateTime(st.updated_at)}
                </>
              ) : (
                "尚未下载"
              )}
            </span>
          </div>
          <ErrorText text={error} />
          {note && <p className="text-xs text-ok">{note}</p>}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        本地数据库每月自动检查更新，也可以随时手动更新。
      </p>
    </Group>
  );
}

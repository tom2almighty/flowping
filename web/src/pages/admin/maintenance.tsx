import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { DatabaseStats } from "@/types";
import { ErrorText, Section, useAction } from "./common";

/** Retention deletes a lot of rows; SQLite keeps the freed pages in the file
 *  until someone compacts it. */
export function MaintenanceSection() {
  const stats = usePoll(() => api.get<DatabaseStats>("/api/v1/admin/database"), 0);
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const st = stats.data;

  const vacuum = () =>
    run(async () => {
      setNote("");
      const r = await api.post<{ before: number; after: number }>("/api/v1/admin/vacuum");
      stats.reload();
      setNote(r.before > r.after ? `已回收 ${fmtBytes(r.before - r.after)}` : "没有可回收的空间");
    });

  return (
    <Section
      title="数据库"
      description="过期数据删除后，空出来的页仍留在文件里，整理一次才会还给文件系统。"
    >
      <p className="text-sm">
        占用 <span className="font-medium tnum">{st ? fmtBytes(st.size) : "—"}</span>
        {st != null && st.reclaimable > 0 && (
          <span className="text-muted-foreground">
            ，可回收 <span className="font-medium tnum">{fmtBytes(st.reclaimable)}</span>
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={vacuum} disabled={busy || !st}>
          回收空间
        </Button>
        {error ? (
          <ErrorText text={error} />
        ) : (
          note && <span className="text-sm text-ok">{note}</span>
        )}
      </div>
    </Section>
  );
}

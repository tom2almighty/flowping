import { Pill, type Tone } from "@/components/status";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { EventRow } from "@/types";
import { PageTitle } from "./common";

const levelTone: Record<string, Tone> = { info: "ok", warning: "warn", critical: "crit" };
const levelLabel: Record<string, string> = { info: "恢复", warning: "警告", critical: "严重" };

export function EventsAdmin() {
  const list = usePoll(() => api.get<EventRow[]>("/api/v1/admin/events?limit=200"), 15000);
  return (
    <div>
      <PageTitle title="事件" />
      {list.data && list.data.length === 0 ? (
        <Empty>还没有事件。上下线、阈值告警和到期提醒会记录在这里，并推送到通知渠道。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>时间</TH>
                <TH>级别</TH>
                <TH>内容</TH>
              </TR>
            </THead>
            <TBody>
              {(list.data ?? []).map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-muted-foreground tnum">
                    {fmtDateTime(e.ts)}
                  </TD>
                  <TD>
                    <Pill tone={levelTone[e.level] ?? "offline"}>
                      {levelLabel[e.level] ?? e.level}
                    </Pill>
                  </TD>
                  <TD className="text-left whitespace-normal">{e.message}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

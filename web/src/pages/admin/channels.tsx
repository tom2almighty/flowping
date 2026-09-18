import { PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/use-poll";
import type { Channel } from "@/types";
import { ErrorText, PageTitle, useAction } from "./common";

function ChannelForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api.post("/api/v1/admin/channels", { name, url });
      onSaved();
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="名称" help="留空则用服务名">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Telegram 群"
          autoFocus
        />
      </Field>
      <Field
        label="Shoutrrr 地址"
        help="例如 telegram://token@telegram?chats=123，格式见 shoutrrr 文档"
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="discord://token@id"
          required
        />
      </Field>
      <ErrorText text={error} />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={busy}>
          添加
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ChannelsAdmin() {
  const list = usePoll(() => api.get<Channel[]>("/api/v1/admin/channels"), 0);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const { error, run, busy } = useAction();

  const toggle = (c: Channel, enabled: boolean) =>
    run(async () => {
      await api.put(`/api/v1/admin/channels/${c.id}`, { enabled });
      list.reload();
    });
  const test = (c: Channel) =>
    run(async () => {
      setNote("");
      await api.post(`/api/v1/admin/channels/${c.id}/test`);
      setNote(`已向 ${c.name} 发送测试通知`);
    });
  const remove = (c: Channel) => {
    if (!confirm(`删除通知渠道 ${c.name}？`)) return;
    run(async () => {
      await api.del(`/api/v1/admin/channels/${c.id}`);
      list.reload();
    });
  };

  return (
    <div>
      <PageTitle title="通知渠道">
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          添加渠道
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-muted-foreground">
        上下线、丢包、资源占用、流量配额和到期提醒会发到所有已启用的渠道。阈值在设置页调整。
      </p>
      <ErrorText text={error} />
      {note && <p className="mb-2 text-sm text-ok">{note}</p>}
      {list.data && list.data.length === 0 ? (
        <Empty>通过 shoutrrr 地址接入 Telegram、Discord、Bark、邮件等几十种服务。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>名称</TH>
                <TH className="hidden md:table-cell">地址</TH>
                <TH>启用</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {(list.data ?? []).map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD
                    className="hidden max-w-md truncate text-muted-foreground tnum md:table-cell"
                    title={c.url}
                  >
                    {c.url.replace(/(:\/\/)([^@/]+)@/, "$1•••@")}
                  </TD>
                  <TD>
                    <Switch
                      checked={c.enabled}
                      onCheckedChange={(v) => toggle(c, v)}
                      aria-label={`启用 ${c.name}`}
                    />
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => test(c)} disabled={busy}>
                        <SendIcon />
                        测试
                      </Button>
                      <Button variant="ghost" size="icon-sm" title="删除" onClick={() => remove(c)}>
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
      {adding && (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)}>
          <DialogContent title="添加通知渠道">
            <ChannelForm
              onClose={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                list.reload();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

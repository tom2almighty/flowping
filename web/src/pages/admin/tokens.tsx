import { PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Empty, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { fmtAgo, fmtDate } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";
import type { ApiToken } from "@/types";
import { CopyBlock, ErrorText, PageTitle, useAction } from "./common";

export function TokensAdmin() {
  const list = usePoll(() => api.get<ApiToken[]>("/api/v1/admin/tokens"), 0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<ApiToken | null>(null);
  const { busy, error, run } = useAction();

  const create = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const t = await api.post<ApiToken>("/api/v1/admin/tokens", { name });
      setCreated(t);
      setAdding(false);
      setName("");
      list.reload();
    });
  };
  const remove = (t: ApiToken) => {
    if (!confirm(`吊销令牌 ${t.name}？使用它的小组件会立即失效。`)) return;
    run(async () => {
      await api.del(`/api/v1/admin/tokens/${t.id}`);
      list.reload();
    });
  };

  return (
    <div>
      <PageTitle title="API 令牌">
        <Button onClick={() => setAdding(true)}>
          <PlusIcon />
          新建令牌
        </Button>
      </PageTitle>
      <p className="mb-4 text-sm text-muted-foreground">
        令牌只读，用于手机小组件等第三方调用。请求时带上{" "}
        <code className="rounded bg-muted px-1">Authorization: Bearer 令牌</code>，可访问
        /api/v1/agents 等读取接口，站点设为非公开时也能用。
      </p>
      <ErrorText text={error} />
      {list.data && list.data.length === 0 ? (
        <Empty>还没有令牌。</Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>名称</TH>
                <TH className="hidden sm:table-cell">创建于</TH>
                <TH>最近使用</TH>
                <TH className="text-right">操作</TH>
              </TR>
            </THead>
            <TBody>
              {(list.data ?? []).map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD className="hidden text-muted-foreground tnum sm:table-cell">
                    {fmtDate(t.created_at)}
                  </TD>
                  <TD className="text-muted-foreground">
                    {t.last_used ? fmtAgo(t.last_used) : "从未"}
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon-sm" title="吊销" onClick={() => remove(t)}>
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
          <DialogContent title="新建 API 令牌">
            <form onSubmit={create} className="flex flex-col gap-4">
              <Field label="名称">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="iPhone 小组件"
                  autoFocus
                />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  创建
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {created?.token && (
        <Dialog open onOpenChange={(o) => !o && setCreated(null)}>
          <DialogContent title="令牌已创建" description="只显示这一次，关闭后无法再查看。">
            <CopyBlock label={created.name} text={created.token} />
            <DialogFooter>
              <Button onClick={() => setCreated(null)}>我已保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

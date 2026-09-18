import { LogInIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errMsg } from "@/lib/api";
import { useSite } from "@/lib/site";

export function LoginPage() {
  const { site, reload } = useSite();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(params.get("error") ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/v1/auth/login", { password });
      await reload();
      navigate("/admin");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-10 w-full max-w-sm">
      <h1 className="mb-6 text-xl font-semibold">登录 {site?.name ?? ""}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="管理员密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </Field>
        {error && <p className="text-sm text-crit">{error}</p>}
        <Button type="submit" disabled={busy}>
          登录
        </Button>
        {site?.github && (
          <Button variant="outline" onClick={() => location.assign("/api/v1/auth/github")}>
            <LogInIcon />
            使用 GitHub 登录
          </Button>
        )}
      </form>
    </div>
  );
}

import { LogOutIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useSite } from "@/lib/site";
import { useThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const nav = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors hover:text-foreground",
    isActive ? "font-medium text-foreground" : "text-muted-foreground",
  );

export function ThemeToggle() {
  const [mode, setMode] = useThemeMode();
  const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  const label = { system: "跟随系统", light: "浅色", dark: "深色" }[mode];
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setMode(next)}
      title={`主题：${label}`}
      aria-label={`主题：${label}，点击切换`}
    >
      {mode === "system" ? <MonitorIcon /> : mode === "light" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

export function Shell() {
  const { site, reload } = useSite();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post("/api/v1/auth/logout");
    await reload();
    navigate("/");
  };
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-card shadow-[0_1px_10px_rgb(0_0_0/0.06)]">
        <div className="mx-auto flex h-12 w-full max-w-[1600px] items-center gap-1 px-4 sm:px-6">
          <NavLink to="/" className="mr-4 flex min-w-0 items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-6 shrink-0" />
            <span className="truncate">{site?.name ?? "FlowPing"}</span>
          </NavLink>
          <nav className="flex items-center gap-0.5" aria-label="主导航">
            <NavLink to="/" end className={nav}>
              服务器
            </NavLink>
            <NavLink to="/latency" className={nav}>
              延迟
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {site?.user ? (
              <>
                <NavLink to="/admin" className={nav} title="管理后台">
                  <SettingsIcon className="size-4 sm:hidden" />
                  <span className="hidden sm:inline">管理</span>
                </NavLink>
                <Button variant="ghost" size="icon-sm" onClick={logout} title="退出登录">
                  <LogOutIcon />
                </Button>
              </>
            ) : (
              <NavLink to="/login" className={nav}>
                登录
              </NavLink>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 sm:px-6">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[1600px] px-4 pb-5 text-xs text-muted-foreground sm:px-6">
        FlowPing {site?.version ?? ""}
      </footer>
    </div>
  );
}

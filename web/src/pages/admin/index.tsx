import {
  BellIcon,
  CrosshairIcon,
  KeyRoundIcon,
  PaletteIcon,
  ScrollTextIcon,
  ServerIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { NavLink, Route, Routes } from "react-router";
import { cn } from "@/lib/utils";
import { AgentsAdmin } from "./agents";
import { ChannelsAdmin } from "./channels";
import { EventsAdmin } from "./events";
import { SettingsAdmin } from "./settings";
import { TargetsAdmin } from "./targets";
import { ThemesAdmin } from "./themes";
import { TokensAdmin } from "./tokens";

// Absolute paths: a relative `to` resolves against the current location, so
// clicking 通知 from /admin/targets would land on /admin/targets/notify.
const items = [
  { to: "/admin", label: "服务器", icon: ServerIcon, end: true },
  { to: "/admin/targets", label: "延迟目标", icon: CrosshairIcon },
  { to: "/admin/notify", label: "通知", icon: BellIcon },
  { to: "/admin/themes", label: "主题", icon: PaletteIcon },
  { to: "/admin/tokens", label: "API 令牌", icon: KeyRoundIcon },
  { to: "/admin/events", label: "事件", icon: ScrollTextIcon },
  { to: "/admin/settings", label: "设置", icon: SlidersHorizontalIcon },
];

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav
        className="flex flex-wrap gap-1 md:w-44 md:flex-col md:flex-nowrap"
        aria-label="管理导航"
      >
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors sm:gap-2 sm:px-2.5 sm:py-1.5",
                isActive
                  ? "bg-nav-active font-medium text-foreground"
                  : "text-muted-foreground hover:bg-row hover:text-foreground",
              )
            }
          >
            <it.icon className="size-4" />
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <Routes>
          <Route index element={<AgentsAdmin />} />
          <Route path="targets" element={<TargetsAdmin />} />
          <Route path="notify" element={<ChannelsAdmin />} />
          <Route path="themes" element={<ThemesAdmin />} />
          <Route path="tokens" element={<TokensAdmin />} />
          <Route path="events" element={<EventsAdmin />} />
          <Route path="settings" element={<SettingsAdmin />} />
        </Routes>
      </div>
    </div>
  );
}

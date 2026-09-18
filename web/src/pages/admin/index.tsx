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

const items = [
  { to: "", label: "服务器", icon: ServerIcon, end: true },
  { to: "targets", label: "延迟目标", icon: CrosshairIcon },
  { to: "notify", label: "通知", icon: BellIcon },
  { to: "themes", label: "主题", icon: PaletteIcon },
  { to: "tokens", label: "API 令牌", icon: KeyRoundIcon },
  { to: "events", label: "事件", icon: ScrollTextIcon },
  { to: "settings", label: "设置", icon: SlidersHorizontalIcon },
];

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="flex gap-1 overflow-x-auto md:w-44 md:flex-col" aria-label="管理导航">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
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

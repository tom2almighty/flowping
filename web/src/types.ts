export interface TrafficSum {
  rx: number;
  tx: number;
}

export interface PeriodUsage {
  start: number;
  end: number;
  rx: number;
  tx: number;
  used: number;
  quota: number;
  pct: number;
}

export interface PingView {
  target_id: string;
  ts: number;
  loss: number;
  p50: number | null;
}

export interface Billing {
  cycle: string;
  days: number;
  price: number;
  currency: string;
  expires_at: string;
  auto_renew: boolean;
  quota: number;
  reset_day: number;
  mode: string;
}

export interface AgentView {
  id: string;
  name: string;
  note: string;
  country: string;
  hidden: boolean;
  tz: string;
  online: boolean;
  pending: boolean;
  last_seen: number;
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  cpus: number;
  agent_version: string;
  uptime: number;
  cpu: number;
  load: [number, number, number];
  mem_total: number;
  mem_used: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  iface: string;
  rx_rate: number;
  tx_rate: number;
  today: TrafficSum;
  month: TrafficSum;
  year: TrafficSum;
  total: TrafficSum;
  period: PeriodUsage;
  billing: Billing;
  days_left: number | null;
  pings: PingView[];
}

export interface Target {
  id: string;
  name: string;
  interval: number;
  agent_ids: string[];
}

export interface AdminAgent {
  id: string;
  name: string;
  token: string;
  note: string;
  country: string;
  ip: string;
  tz: string;
  tz_offset: number;
  iface: string;
  interval: number;
  sort_order: number;
  hidden: boolean;
  billing: Billing;
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  cpus: number;
  agent_version: string;
  last_seen: number;
  created_at: number;
  updated_at: number;
}

export interface AdminTarget {
  id: string;
  name: string;
  host: string;
  port: number;
  interval: number;
  count: number;
  timeout_ms: number;
  all_agents: boolean;
  agent_ids: string[];
  enabled: boolean;
  sort_order: number;
  created_at: number;
}

export interface PingSeries {
  agent_id: string;
  target_id: string;
  ts: number[];
  sent: number[];
  recv: number[];
  min: (number | null)[];
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  max: (number | null)[];
  avg: (number | null)[];
}

export interface PingResponse {
  tier: string;
  step: number;
  from: number;
  to: number;
  series: PingSeries[];
}

export interface TrafficRow {
  key: string;
  rx: number;
  tx: number;
}

export interface HourRow {
  hour: number;
  rx: number;
  tx: number;
}

export interface MetricRow {
  ts: number;
  cpu: number;
  mem: number;
  rx_rate: number;
  tx_rate: number;
}

export interface Site {
  name: string;
  public: boolean;
  theme: string;
  github: boolean;
  version: string;
  user: string;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: number;
}

export interface ApiToken {
  id: string;
  name: string;
  created_at: number;
  last_used: number;
  token?: string;
}

export interface EventRow {
  id: number;
  ts: number;
  agent_id: string;
  kind: string;
  level: string;
  message: string;
}

export interface ThemeMeta {
  name: string;
  title: string;
  author: string;
  version: string;
  description: string;
  preview?: string;
  url?: string;
}

export type Settings = Record<string, string>;

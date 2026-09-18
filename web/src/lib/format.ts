const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function fmtBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${UNITS[i]}`;
}

export function fmtRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 1) return "0 B/s";
  let i = 0;
  let v = bps;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${UNITS[i]}/s`;
}

const trimZeros = (s: string) => s.replace(/\.?0+$/, "");

/** Compact byte size for table cells, `sig` significant digits at most so the
 *  label has a known width: 228B, 13K, 27.8K, 5.63K, 357G. `sig` 2 is for
 *  phone columns: 36G, 9.5G. */
export function fmtBytesShort(n: number, sig = 3): string {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const whole = v >= 100 ? 3 : v >= 10 ? 2 : 1;
  const digits = i === 0 ? 0 : Math.max(0, sig - whole);
  const s = v.toFixed(digits);
  return (digits > 0 ? trimZeros(s) : s) + UNITS[i].replace("i", "");
}

/** Same scale for a rate, without the per-second suffix the header carries. */
export const fmtRateShort = fmtBytesShort;

/** Load average, trimmed to the two decimals `uptime` prints. */
export const fmtLoad = (v: number) => v.toFixed(2);

export function fmtPct(v: number, digits = 0): string {
  return `${v.toFixed(digits)}%`;
}

export function fmtMs(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
}

export function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.max(0, Math.floor(secs))} 秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)} 分钟`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} 小时 ${Math.floor((secs % 3600) / 60)} 分钟`;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
}

/** Whole days as the table's 在线 column shows them: 97 天, 2 小时. */
export function fmtUptime(secs: number): string {
  if (secs < 86400) return fmtDuration(secs);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
}

export function fmtAgo(ts: number): string {
  if (!ts) return "从未";
  return `${fmtDuration(Date.now() / 1000 - ts)}前`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Axis tick label whose detail follows the span being shown. */
export function fmtTick(ts: number, spanSecs: number): string {
  const d = new Date(ts * 1000);
  if (spanSecs <= 2 * 86400) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (spanSecs <= 40 * 86400) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function fmtMoney(price: number, currency: string): string {
  const sym: Record<string, string> = {
    USD: "$",
    CNY: "¥",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    HKD: "HK$",
  };
  const s = sym[currency.toUpperCase()];
  const v = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return s ? `${s}${v}` : `${v} ${currency}`;
}

export const CYCLE_LABEL: Record<string, string> = {
  free: "免费",
  lifetime: "长期",
  monthly: "月付",
  quarterly: "季付",
  semiannual: "半年付",
  yearly: "年付",
  custom: "自定义",
};

export const CYCLE_SUFFIX: Record<string, string> = {
  monthly: "/月",
  quarterly: "/季",
  semiannual: "/半年",
  yearly: "/年",
};

export const MODE_LABEL: Record<string, string> = {
  both: "双向",
  rx: "仅入站",
  tx: "仅出站",
  max: "取大者",
};

export function lossBucket(lossPct: number): 0 | 1 | 2 | 3 | 4 {
  if (lossPct <= 0) return 0;
  if (lossPct <= 5) return 1;
  if (lossPct <= 20) return 2;
  if (lossPct <= 50) return 3;
  return 4;
}

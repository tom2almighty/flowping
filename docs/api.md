# API

所有接口在 `/api/v1` 下，返回 JSON。错误统一为：

```json
{ "code": "not_found", "message": "no such agent" }
```

## 鉴权

- 站点公开时（默认），读取接口无需鉴权，但看不到设为隐藏的服务器。
- 站点非公开时，读取接口需要登录会话或 API 令牌。
- API 令牌在后台创建，只读，用法：`Authorization: Bearer fpk_...`。带令牌时可以看到隐藏的服务器。
- 管理接口（`/api/v1/admin/*`）只接受登录会话。

## 读取接口

### `GET /api/v1/site`

站点名称、是否公开、当前主题、是否启用 GitHub 登录、版本、当前登录用户。

### `GET /api/v1/agents`

所有服务器的当前状态。适合做小组件的主要接口。

```json
[
  {
    "id": "abc123",
    "name": "东京",
    "country": "jp",
    "online": true,
    "pending": false,
    "last_seen": 1758172800,
    "uptime": 864000,
    "cpu": 12.5,
    "load": [0.3, 0.2, 0.1],
    "mem_total": 2147483648,
    "mem_used": 1073741824,
    "disk_total": 42949672960,
    "disk_used": 21474836480,
    "rx_rate": 125000,
    "tx_rate": 84000,
    "today": { "rx": 1073741824, "tx": 536870912 },
    "month": { "rx": 32212254720, "tx": 16106127360 },
    "year": { "rx": 0, "tx": 0 },
    "total": { "rx": 0, "tx": 0 },
    "period": { "start": 1756656000, "end": 1759248000, "rx": 0, "tx": 0, "used": 0, "quota": 1099511627776, "pct": 4.4 },
    "billing": { "cycle": "monthly", "price": 5, "currency": "USD", "expires_at": "2026-10-01", "quota": 1099511627776, "reset_day": 1, "mode": "both" },
    "days_left": 13,
    "pings": [{ "target_id": "t1", "ts": 1758172740, "loss": 0, "p50": 42.1 }]
  }
]
```

字节单位一律是 bytes，速率是 bytes/s，延迟是毫秒。`period` 是当前流量计费周期，`used` 已按计费方式（双向/仅入/仅出/取大）折算。`days_left` 在免费或长期时为 `null`。

### `GET /api/v1/agents/{id}`

单台服务器，字段同上。

### `GET /api/v1/agents/{id}/traffic?period=day|month|year|hour&limit=N`

流量明细。`day`/`month`/`year` 返回 `[{ "key": "2026-09-18", "rx": 0, "tx": 0 }]`，key 按 agent 本机时区切分；`hour` 返回 `[{ "hour": 1758172800, "rx": 0, "tx": 0 }]`，hour 为该小时起点的 unix 秒。默认分别返回最近 31 天、24 个月、10 年、48 小时。

### `GET /api/v1/agents/{id}/metrics?hours=24`

每分钟一条的 CPU 百分比、内存百分比、上下行速率，最多 168 小时。

### `GET /api/v1/targets`

已启用的延迟监测目标：`id`、`name`、`interval`、`agent_ids`（空数组表示全部服务器）。

### `GET /api/v1/ping?agent=&target=&from=&to=`

延迟序列。`from`/`to` 为 unix 秒，默认最近 3 小时；`agent` 和 `target` 可省略其一或全部。返回：

```json
{
  "tier": "ping_raw",
  "step": 60,
  "from": 1758160000,
  "to": 1758172800,
  "series": [
    {
      "agent_id": "abc123",
      "target_id": "t1",
      "ts": [1758160020, 1758160080],
      "sent": [20, 20],
      "recv": [20, 19],
      "min": [40.1, 40.3],
      "p25": [41.0, 41.2],
      "p50": [42.1, 42.0],
      "p75": [43.5, 44.0],
      "max": [51.2, 88.9],
      "avg": [42.8, 43.1]
    }
  ]
}
```

粒度由范围自动选择：36 小时内用原始数据（每个探测周期一条），8 天内用 5 分钟汇总，更长用 1 小时汇总。原始数据保留 7 天，5 分钟汇总保留 30 天，小时汇总保留 2 年。全部丢包的周期延迟字段为 `null`。

## 管理接口

需要登录。路径与后台页面一一对应：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/v1/admin/agents` | 列表、创建 |
| PUT/DELETE | `/api/v1/admin/agents/{id}` | 更新、删除 |
| POST | `/api/v1/admin/agents/{id}/rotate-token` | 重置 agent 令牌 |
| GET | `/api/v1/admin/agents/{id}/install` | 三种部署命令 |
| GET/POST | `/api/v1/admin/targets` | 延迟目标 |
| PUT/DELETE | `/api/v1/admin/targets/{id}` | |
| GET/POST | `/api/v1/admin/channels` | 通知渠道 |
| PUT/DELETE | `/api/v1/admin/channels/{id}` | |
| POST | `/api/v1/admin/channels/{id}/test` | 发送测试通知 |
| GET/PUT | `/api/v1/admin/settings` | 站点与阈值设置 |
| POST | `/api/v1/admin/password` | 修改密码 |
| GET/POST | `/api/v1/admin/tokens` | API 令牌 |
| DELETE | `/api/v1/admin/tokens/{id}` | |
| GET | `/api/v1/admin/events?limit=100` | 事件日志 |
| GET | `/api/v1/admin/themes` | 已安装主题 |
| GET | `/api/v1/admin/themes/market` | 市场列表 |
| POST | `/api/v1/admin/themes/install` | 从 zip 地址安装 |
| DELETE | `/api/v1/admin/themes/{name}` | |

## 认证接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/login` | `{ "password": "..." }` |
| POST | `/api/v1/auth/logout` | |
| GET | `/api/v1/auth/me` | 当前用户 |
| GET | `/api/v1/auth/github` | 跳转 GitHub 授权 |
| GET | `/api/v1/auth/github/callback` | 回调 |

## agent 接口

agent 使用自己的令牌（`fpa_` 开头）调用，无需人工使用：

- `POST /api/v1/agent/report`：上报指标与延迟结果，响应带 `config_version`
- `GET /api/v1/agent/config`：拉取上报间隔、网卡和目标列表

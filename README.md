# FlowPing

服务器监控面板，重点是流量统计和 smokeping 风格的延迟图。

- 多台服务器的在线状态、CPU、内存、磁盘、网速
- 按日、月、年、累计的流量统计，支持流量配额和重置日
- agent 到任意 TCP 目标的延迟与丢包，中位数加烟雾带，按丢包率着色
- 付费信息：周期、到期时间、价格、币种，到期前提醒
- 通过 [shoutrrr](https://github.com/nicholas-fedor/shoutrrr) 推送上下线、阈值、配额、到期通知
- 密码或 GitHub OAuth 登录后台，只读 API 令牌供小组件调用
- 主题市场只加载样式表和静态资源，不引入脚本

hub 和 agent 各是一个静态二进制，agent 主动上报，不需要开放端口。agent 只支持 Linux。

## 部署 hub

### Docker Compose

```sh
mkdir flowping && cd flowping
curl -fsSLO https://raw.githubusercontent.com/tom2almighty/flowping/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/tom2almighty/flowping/main/.env.example -o .env
# 编辑 .env，至少填写 FLOWPING_BASE_URL 和 FLOWPING_ADMIN_PASSWORD
docker compose up -d
```

### 二进制

从 [Releases](https://github.com/tom2almighty/flowping/releases) 下载对应平台的 `flowping-hub`，环境变量见 `.env.example`：

```sh
FLOWPING_DATA=/var/lib/flowping FLOWPING_BASE_URL=https://ping.example.com ./flowping-hub
```

首次启动没有设置 `FLOWPING_ADMIN_PASSWORD` 时，会生成一个随机密码打印到日志。反向代理和 HTTPS 自行处理；经过代理时把 `FLOWPING_TRUST_PROXY` 设为 `true`。

## 部署 agent

登录后台 → 服务器 → 添加，会得到三种部署命令，任选一种在目标机器上以 root 执行：

```sh
# 二进制 + systemd
curl -fsSL https://ping.example.com/install.sh | sh -s -- --hub https://ping.example.com --token <token>

# Docker
docker run -d --name flowping-agent --restart unless-stopped --net host --pid host -v /:/host:ro \
  -e FLOWPING_HUB=https://ping.example.com -e FLOWPING_TOKEN=<token> ghcr.io/tom2almighty/flowping-agent:latest

# Docker Compose：生成 /opt/flowping-agent/compose.yaml 后启动
mkdir -p /opt/flowping-agent && cat > /opt/flowping-agent/compose.yaml <<'EOF'
services:
  flowping-agent:
    image: ghcr.io/tom2almighty/flowping-agent:latest
    container_name: flowping-agent
    restart: unless-stopped
    network_mode: host
    pid: host
    volumes:
      - /:/host:ro
    environment:
      FLOWPING_HUB: https://ping.example.com
      FLOWPING_TOKEN: <token>
    # 用 watchtower 自动更新 agent 时取消注释
    # labels:
    #   com.centurylinklabs.watchtower.enable: "true"
EOF
cd /opt/flowping-agent && docker compose up -d
```

Docker 方式必须使用 host 网络和 host PID，并只读挂载根目录到 `/host`，否则读到的是容器自己的数据。

agent 子命令：`install`（写入 systemd 服务）、`uninstall`、`version`。

## IP 归属地

服务器留空国家代码时，hub 会按上报请求的来源 IP 识别国旗。三种方式在设置页切换：

- **在线查询**（默认）：调用 ipwho.is，失败时回退 ip-api.com。不需要任何磁盘数据，但每个新服务器会把 IP 交给第三方，且受对方额度限制。
- **本地数据库**：从可配置的地址下载国家库到数据目录（`geoip.mmdb`），本地查表。不外发 IP、无额度限制、内网也能用。默认下载源是 [Loyalsoldier/geoip](https://github.com/Loyalsoldier/geoip) 镜像的 GeoLite2-Country，可换成 [DB-IP Lite](https://db-ip.com/db/download/ip-to-country-lite)（支持 `.mmdb.gz`）或自建镜像。库文件每月自动检查更新，也可以在设置页手动更新。
- **关闭**：不识别，只显示手工填写的代码。

手工填过国家代码的服务器不会被自动覆盖，清空后重新交给自动识别，换 IP 后会重新解析。

GeoLite2 数据受 MaxMind 的许可约束（CC BY-SA 4.0，需署名）；DB-IP Lite 为 CC BY 4.0。下载源可配置，请按自己接受的条款选择来源。

## API

第三方调用见 [docs/api.md](docs/api.md)。

## 开发

```sh
# 前端
cd web && bun install && bun run dev    # 代理到 127.0.0.1:8080
bun run check                            # biome

# 后端
go run ./cmd/hub
go run ./cmd/agent --hub http://127.0.0.1:8080 --token <token>

# 完整构建（前端产物嵌入 hub 二进制）
cd web && bun run build && cd .. && go build ./cmd/hub ./cmd/agent
```

在 `dev` 分支开发，合并到 `main` 触发 CI；推送 `vx.y.z` 标签发布二进制和镜像。

## 主题

主题是一个 zip，根目录包含：

- `theme.json`：`name`（小写字母、数字、`-`、`_`）、`title`、`author`、`version`、`description`、可选 `preview`
- `theme.css`：覆盖 `:root` 和 `.dark` 下的 CSS 变量，变量名见 `web/src/styles/globals.css`
- 可选的字体和图片，用相对路径引用

主题市场是一个返回 `theme.json` 数组的 `index.json`，每项多一个 `url` 指向 zip。市场地址在设置里修改。

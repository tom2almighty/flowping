package hub

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

// alertEngine turns conditions into debounced enter/exit notifications.
// Every kind is evaluated on a schedule; a condition must hold for its grace
// period before it fires, and clears as soon as it stops holding.
type alertEngine struct {
	h      *Hub
	mu     sync.Mutex
	states map[[2]string]store.AlertState
}

func newAlertEngine(h *Hub, states map[[2]string]store.AlertState) *alertEngine {
	return &alertEngine{h: h, states: states}
}

func (e *alertEngine) get(id, kind string) store.AlertState {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.states[[2]string{id, kind}]
}

func (e *alertEngine) set(ctx context.Context, id, kind string, st store.AlertState) {
	e.mu.Lock()
	e.states[[2]string{id, kind}] = st
	e.mu.Unlock()
	if err := e.h.db.SaveAlertState(ctx, id, kind, st); err != nil {
		e.h.log.Error("save alert state", "err", err)
	}
}

// transition returns +1 when the alert fires, -1 when it clears, 0 otherwise.
func (e *alertEngine) transition(ctx context.Context, id, kind string, cond bool, grace int64, now int64) int {
	st := e.get(id, kind)
	switch {
	case cond && !st.Active:
		if st.Since == 0 {
			st.Since = now
		}
		if now-st.Since < grace {
			e.set(ctx, id, kind, st)
			return 0
		}
		st.Active, st.LastNotified = true, now
		e.set(ctx, id, kind, st)
		return 1
	case !cond && st.Active:
		st.Active, st.Since = false, 0
		e.set(ctx, id, kind, st)
		return -1
	case !cond && st.Since != 0:
		st.Since = 0
		e.set(ctx, id, kind, st)
	}
	return 0
}

// evaluateFast runs every 10 seconds and only watches liveness.
func (e *alertEngine) evaluateFast(ctx context.Context) {
	h := e.h
	if h.setting("notify_offline") != "true" {
		return
	}
	agents, err := h.db.ListAgents(ctx)
	if err != nil {
		return
	}
	now := time.Now()
	grace := int64(h.settingInt("offline_grace"))
	if grace < 15 {
		grace = 15
	}
	for _, a := range agents {
		lastSeen := a.LastSeen
		if la, ok := h.st.get(a.ID); ok {
			lastSeen = la.at.Unix()
		}
		if lastSeen == 0 {
			continue
		}
		offline := now.Unix()-lastSeen > grace
		st := e.get(a.ID, "offline")
		switch e.transition(ctx, a.ID, "offline", offline, 0, now.Unix()) {
		case 1:
			h.notify(ctx, a.ID, "offline", "critical", fmt.Sprintf("🔴 %s 离线（最后上报于 %s 前）", a.Name, humanDuration(now.Unix()-lastSeen)))
		case -1:
			h.notify(ctx, a.ID, "online", "info", fmt.Sprintf("🟢 %s 恢复在线（离线 %s）", a.Name, humanDuration(now.Unix()-st.Since)))
		}
	}
}

// evaluateSlow runs every minute for everything that needs a trend.
func (e *alertEngine) evaluateSlow(ctx context.Context) {
	h := e.h
	views, err := h.agentViews(ctx)
	if err != nil {
		return
	}
	targets, _ := h.db.ListTargets(ctx)
	targetName := map[string]string{}
	for _, t := range targets {
		targetName[t.ID] = t.Name
	}
	now := time.Now().Unix()
	loadGrace := int64(h.settingInt("load_grace"))
	pingGrace := int64(h.settingInt("ping_grace"))
	cpuPct, memPct, diskPct := h.settingFloat("cpu_pct"), h.settingFloat("mem_pct"), h.settingFloat("disk_pct")
	lossPct, latencyMS := h.settingFloat("loss_pct"), h.settingFloat("latency_ms")
	trafficPct, expireDays := h.settingFloat("traffic_pct"), h.settingInt("expire_days")

	for _, v := range views {
		if v.Online {
			e.threshold(ctx, v.ID, "cpu", cpuPct, v.CPU, loadGrace, now, "CPU", v.Name)
			e.threshold(ctx, v.ID, "mem", memPct, v.memPct(), loadGrace, now, "内存", v.Name)
			e.threshold(ctx, v.ID, "disk", diskPct, v.diskPct(), loadGrace, now, "磁盘", v.Name)
			for _, p := range v.Pings {
				tn := targetName[p.TargetID]
				if tn == "" {
					continue
				}
				switch e.transition(ctx, v.ID, "loss:"+p.TargetID, lossPct > 0 && p.Loss >= lossPct, pingGrace, now) {
				case 1:
					h.notify(ctx, v.ID, "loss", "warning", fmt.Sprintf("🟠 %s → %s 丢包 %.0f%%", v.Name, tn, p.Loss))
				case -1:
					h.notify(ctx, v.ID, "loss", "info", fmt.Sprintf("🟢 %s → %s 丢包恢复（%.0f%%）", v.Name, tn, p.Loss))
				}
				high := latencyMS > 0 && p.P50 != nil && *p.P50 >= latencyMS
				switch e.transition(ctx, v.ID, "latency:"+p.TargetID, high, pingGrace, now) {
				case 1:
					h.notify(ctx, v.ID, "latency", "warning", fmt.Sprintf("🟠 %s → %s 中位延迟 %.0f ms", v.Name, tn, *p.P50))
				case -1:
					h.notify(ctx, v.ID, "latency", "info", fmt.Sprintf("🟢 %s → %s 延迟恢复正常", v.Name, tn))
				}
			}
		}
		if v.Period.Quota > 0 {
			if e.transition(ctx, v.ID, "traffic", trafficPct > 0 && v.Period.Pct >= trafficPct, 0, now) == 1 {
				h.notify(ctx, v.ID, "traffic", "warning", fmt.Sprintf("📶 %s 本周期流量已用 %.0f%%（%s / %s）", v.Name, v.Period.Pct, humanBytes(v.Period.Used), humanBytes(v.Period.Quota)))
			}
		}
		if v.DaysLeft != nil {
			d := *v.DaysLeft
			if e.transition(ctx, v.ID, "expiring", expireDays > 0 && d >= 0 && d <= expireDays, 0, now) == 1 {
				h.notify(ctx, v.ID, "expiring", "warning", fmt.Sprintf("⏳ %s 将在 %d 天后到期（%s）", v.Name, d, v.Billing.ExpiresAt))
			}
			if e.transition(ctx, v.ID, "expired", d < 0, 0, now) == 1 {
				h.notify(ctx, v.ID, "expired", "critical", fmt.Sprintf("⛔ %s 已于 %s 到期", v.Name, v.Billing.ExpiresAt))
			}
		}
	}
}

func (e *alertEngine) threshold(ctx context.Context, id, kind string, limit, value float64, grace, now int64, label, name string) {
	switch e.transition(ctx, id, kind, limit > 0 && value >= limit, grace, now) {
	case 1:
		e.h.notify(ctx, id, kind, "warning", fmt.Sprintf("🟠 %s %s 使用率 %.0f%%，已持续 %s", name, label, value, humanDuration(grace)))
	case -1:
		e.h.notify(ctx, id, kind, "info", fmt.Sprintf("🟢 %s %s 使用率回落到 %.0f%%", name, label, value))
	}
}

func humanDuration(secs int64) string {
	switch {
	case secs < 60:
		return fmt.Sprintf("%d 秒", secs)
	case secs < 3600:
		return fmt.Sprintf("%d 分钟", secs/60)
	case secs < 86400:
		return fmt.Sprintf("%d 小时 %d 分钟", secs/3600, secs%3600/60)
	default:
		return fmt.Sprintf("%d 天 %d 小时", secs/86400, secs%86400/3600)
	}
}

func humanBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %ciB", float64(b)/float64(div), "KMGTPE"[exp])
}

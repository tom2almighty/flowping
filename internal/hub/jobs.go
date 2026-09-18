package hub

import (
	"context"
	"database/sql"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

const (
	rawRetention = 7 * 24 * time.Hour
	m5Retention  = 30 * 24 * time.Hour
	h1Retention  = 730 * 24 * time.Hour
)

func (h *Hub) runJobs(ctx context.Context) {
	flush := time.NewTicker(30 * time.Second)
	agg := time.NewTicker(5 * time.Minute)
	fast := time.NewTicker(10 * time.Second)
	slow := time.NewTicker(time.Minute)
	defer flush.Stop()
	defer agg.Stop()
	defer fast.Stop()
	defer slow.Stop()
	for {
		select {
		case <-ctx.Done():
			h.flush(context.Background())
			return
		case <-flush.C:
			h.flush(ctx)
		case <-agg.C:
			h.aggregate(ctx)
		case <-fast.C:
			h.alerts.evaluateFast(ctx)
		case <-slow.C:
			h.alerts.evaluateSlow(ctx)
			h.autoRenew(ctx)
			h.geo.MaybeRefresh(ctx)
		}
	}
}

// flush writes buffered traffic deltas, counter baselines and minute metrics
// in one transaction so a crash can never double count.
func (h *Hub) flush(ctx context.Context) {
	b := h.st.takeBatch()
	if len(b.traffic) == 0 && len(b.minutes) == 0 && len(b.counters) == 0 {
		return
	}
	err := h.db.Tx(ctx, func(tx *sql.Tx) error {
		for id, buckets := range b.traffic {
			for k, t := range buckets {
				if err := h.db.AddTraffic(ctx, tx, id, k.hour, k.day, t.rx, t.tx); err != nil {
					return err
				}
			}
		}
		for id, c := range b.counters {
			if err := h.db.SaveCounter(ctx, tx, id, c); err != nil {
				return err
			}
		}
		for _, m := range b.minutes {
			if err := h.db.AddMetric(ctx, tx, m.agentID, m.row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		h.log.Error("flush failed", "err", err)
		h.st.restore(b)
	}
}

func (h *Hub) aggregate(ctx context.Context) {
	now := time.Now()
	since := now.Add(-25 * time.Hour).Unix()
	if late := h.st.takeLateTS(); late > 0 && late < since {
		since = late
	}
	steps := []struct {
		src, dst store.Tier
		secs     int
		since    int64
	}{
		{store.TierRaw, store.Tier5m, 300, since},
		{store.Tier5m, store.Tier1h, 3600, since - 3600},
	}
	for _, s := range steps {
		if err := h.db.Aggregate(ctx, s.src, s.dst, s.secs, s.since); err != nil {
			h.log.Error("aggregate failed", "dst", s.dst, "err", err)
		}
	}
	prunes := []struct {
		tier   store.Tier
		before int64
	}{
		{store.TierRaw, now.Add(-rawRetention).Unix()},
		{store.Tier5m, now.Add(-m5Retention).Unix()},
		{store.Tier1h, now.Add(-h1Retention).Unix()},
	}
	for _, p := range prunes {
		if err := h.db.PrunePings(ctx, p.tier, p.before); err != nil {
			h.log.Error("prune failed", "tier", p.tier, "err", err)
		}
	}
	_ = h.db.PruneMetrics(ctx, now.Add(-7*24*time.Hour).Unix())
	_ = h.db.PruneTrafficHourly(ctx, now.Add(-90*24*time.Hour).Unix())
	_ = h.db.PruneEvents(ctx, now.Add(-90*24*time.Hour).Unix())
	_ = h.db.PruneSessions(ctx)
}

// autoRenew rolls expired billing dates forward for agents that asked for it.
func (h *Hub) autoRenew(ctx context.Context) {
	agents, err := h.db.ListAgents(ctx)
	if err != nil {
		return
	}
	now := time.Now()
	for _, a := range agents {
		if !a.Billing.AutoRenew || a.Billing.ExpiresAt == "" {
			continue
		}
		next, changed := renewedExpiry(a.Billing, now, a.Location())
		if changed {
			if err := h.db.SetAgentExpiry(ctx, a.ID, next); err == nil {
				h.log.Info("billing renewed", "agent", a.Name, "expires_at", next)
			}
		}
	}
}

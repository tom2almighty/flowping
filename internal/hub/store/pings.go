package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/tom2almighty/flowping/internal/proto"
)

// Tier names the ping tables; they share one schema.
type Tier string

const (
	TierRaw Tier = "ping_raw"
	Tier5m  Tier = "ping_5m"
	Tier1h  Tier = "ping_1h"
)

// PingSeries is one (agent, target) series in columnar form; latency columns
// hold null where a bucket saw no reply.
type PingSeries struct {
	AgentID  string     `json:"agent_id"`
	TargetID string     `json:"target_id"`
	TS       []int64    `json:"ts"`
	Sent     []int      `json:"sent"`
	Recv     []int      `json:"recv"`
	Min      []*float64 `json:"min"`
	P25      []*float64 `json:"p25"`
	P50      []*float64 `json:"p50"`
	P75      []*float64 `json:"p75"`
	Max      []*float64 `json:"max"`
	Avg      []*float64 `json:"avg"`
}

func (s *Store) InsertPings(ctx context.Context, tx *sql.Tx, agentID string, results []proto.PingResult, maxTS int64) error {
	stmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO ping_raw (agent_id, target_id, ts, sent, recv, min, p25, p50, p75, max, avg) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range results {
		if r.TS > maxTS || r.TargetID == "" {
			continue
		}
		var lat [6]any
		if r.Recv > 0 {
			lat = [6]any{r.Min, r.P25, r.P50, r.P75, r.Max, r.Avg}
		}
		if _, err := stmt.ExecContext(ctx, agentID, r.TargetID, r.TS, r.Sent, r.Recv, lat[0], lat[1], lat[2], lat[3], lat[4], lat[5]); err != nil {
			return err
		}
	}
	return nil
}

// Aggregate folds src rows with ts >= since into dst buckets of width secs.
// Reply-weighted means keep a bucket of mostly-lost cycles from being
// dominated by its few successful probes' noise.
func (s *Store) Aggregate(ctx context.Context, src, dst Tier, secs int, since int64) error {
	q := fmt.Sprintf(`INSERT INTO %s (agent_id, target_id, ts, sent, recv, min, p25, p50, p75, max, avg)
SELECT agent_id, target_id, (ts / %d) * %d, SUM(sent), SUM(recv), MIN(min),
  SUM(p25 * recv) / NULLIF(SUM(CASE WHEN p25 IS NULL THEN 0 ELSE recv END), 0),
  SUM(p50 * recv) / NULLIF(SUM(CASE WHEN p50 IS NULL THEN 0 ELSE recv END), 0),
  SUM(p75 * recv) / NULLIF(SUM(CASE WHEN p75 IS NULL THEN 0 ELSE recv END), 0),
  MAX(max),
  SUM(avg * recv) / NULLIF(SUM(CASE WHEN avg IS NULL THEN 0 ELSE recv END), 0)
FROM %s WHERE ts >= ? GROUP BY agent_id, target_id, (ts / %d) * %d
ON CONFLICT(agent_id, target_id, ts) DO UPDATE SET sent=excluded.sent, recv=excluded.recv, min=excluded.min,
  p25=excluded.p25, p50=excluded.p50, p75=excluded.p75, max=excluded.max, avg=excluded.avg`, dst, secs, secs, src, secs, secs)
	_, err := s.db.ExecContext(ctx, q, since-int64(since%int64(secs)))
	return err
}

func (s *Store) PrunePings(ctx context.Context, tier Tier, before int64) error {
	_, err := s.db.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s WHERE ts<?", tier), before)
	return err
}

// QueryPings returns series for the given filters; empty agentID or targetID
// means all.
func (s *Store) QueryPings(ctx context.Context, tier Tier, agentID, targetID string, from, to int64) ([]PingSeries, error) {
	q := fmt.Sprintf("SELECT agent_id, target_id, ts, sent, recv, min, p25, p50, p75, max, avg FROM %s WHERE ts>=? AND ts<?", tier)
	args := []any{from, to}
	if agentID != "" {
		q += " AND agent_id=?"
		args = append(args, agentID)
	}
	if targetID != "" {
		q += " AND target_id=?"
		args = append(args, targetID)
	}
	q += " ORDER BY agent_id, target_id, ts"
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PingSeries{}
	idx := -1
	for rows.Next() {
		var aid, tid string
		var ts int64
		var sent, recv int
		var lat [6]sql.NullFloat64
		if err := rows.Scan(&aid, &tid, &ts, &sent, &recv, &lat[0], &lat[1], &lat[2], &lat[3], &lat[4], &lat[5]); err != nil {
			return nil, err
		}
		if idx < 0 || out[idx].AgentID != aid || out[idx].TargetID != tid {
			out = append(out, PingSeries{AgentID: aid, TargetID: tid})
			idx = len(out) - 1
		}
		cur := &out[idx]
		cur.TS = append(cur.TS, ts)
		cur.Sent = append(cur.Sent, sent)
		cur.Recv = append(cur.Recv, recv)
		cur.Min = append(cur.Min, nf(lat[0]))
		cur.P25 = append(cur.P25, nf(lat[1]))
		cur.P50 = append(cur.P50, nf(lat[2]))
		cur.P75 = append(cur.P75, nf(lat[3]))
		cur.Max = append(cur.Max, nf(lat[4]))
		cur.Avg = append(cur.Avg, nf(lat[5]))
	}
	return out, rows.Err()
}

func nf(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := float64(int64(v.Float64*1000+0.5)) / 1000
	return &f
}

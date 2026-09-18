package store

import (
	"context"
	"database/sql"
)

type TrafficRow struct {
	Key string `json:"key"` // day "2006-01-02", month "2006-01", year "2006"
	Rx  int64  `json:"rx"`
	Tx  int64  `json:"tx"`
}

type HourRow struct {
	Hour int64 `json:"hour"` // unix ts of the agent-local hour start
	Rx   int64 `json:"rx"`
	Tx   int64 `json:"tx"`
}

type AgentTraffic struct {
	AgentID string
	Day     string
	Rx, Tx  int64
}

func (s *Store) AddTraffic(ctx context.Context, tx *sql.Tx, agentID string, hour int64, day string, rx, txb int64) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO traffic_hourly (agent_id, hour, rx, tx) VALUES (?,?,?,?)
ON CONFLICT(agent_id, hour) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx`, agentID, hour, rx, txb); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO traffic_daily (agent_id, day, rx, tx) VALUES (?,?,?,?)
ON CONFLICT(agent_id, day) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx`, agentID, day, rx, txb)
	return err
}

func (s *Store) TrafficHourly(ctx context.Context, agentID string, from int64) ([]HourRow, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT hour, rx, tx FROM traffic_hourly WHERE agent_id=? AND hour>=? ORDER BY hour", agentID, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HourRow{}
	for rows.Next() {
		var r HourRow
		if err := rows.Scan(&r.Hour, &r.Rx, &r.Tx); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TrafficGrouped returns per-period sums for one agent. keyLen is 10 for
// days, 7 for months and 4 for years; limit caps the newest periods returned.
func (s *Store) TrafficGrouped(ctx context.Context, agentID string, keyLen, limit int) ([]TrafficRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT k, rx, tx FROM (
SELECT substr(day,1,?) AS k, SUM(rx) AS rx, SUM(tx) AS tx FROM traffic_daily WHERE agent_id=? GROUP BY k ORDER BY k DESC LIMIT ?
) ORDER BY k`, keyLen, agentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrafficRow{}
	for rows.Next() {
		var r TrafficRow
		if err := rows.Scan(&r.Key, &r.Rx, &r.Tx); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TrafficDailySince returns daily rows for every agent from fromDay on; the
// caller folds them into today/month/year/period figures per agent zone.
func (s *Store) TrafficDailySince(ctx context.Context, fromDay string) ([]AgentTraffic, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT agent_id, day, rx, tx FROM traffic_daily WHERE day>=? ORDER BY agent_id, day", fromDay)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentTraffic
	for rows.Next() {
		var r AgentTraffic
		if err := rows.Scan(&r.AgentID, &r.Day, &r.Rx, &r.Tx); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) TrafficTotals(ctx context.Context) (map[string][2]int64, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT agent_id, SUM(rx), SUM(tx) FROM traffic_daily GROUP BY agent_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][2]int64{}
	for rows.Next() {
		var id string
		var rx, tx int64
		if err := rows.Scan(&id, &rx, &tx); err != nil {
			return nil, err
		}
		out[id] = [2]int64{rx, tx}
	}
	return out, rows.Err()
}

func (s *Store) PruneTrafficHourly(ctx context.Context, before int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM traffic_hourly WHERE hour<?", before)
	return err
}

type MetricRow struct {
	TS     int64   `json:"ts"`
	CPU    float64 `json:"cpu"`
	Mem    float64 `json:"mem"`
	RxRate float64 `json:"rx_rate"`
	TxRate float64 `json:"tx_rate"`
}

func (s *Store) AddMetric(ctx context.Context, tx *sql.Tx, agentID string, m MetricRow) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO metrics_minute (agent_id, ts, cpu, mem, rx_rate, tx_rate) VALUES (?,?,?,?,?,?)
ON CONFLICT(agent_id, ts) DO UPDATE SET cpu=excluded.cpu, mem=excluded.mem, rx_rate=excluded.rx_rate, tx_rate=excluded.tx_rate`,
		agentID, m.TS, m.CPU, m.Mem, m.RxRate, m.TxRate)
	return err
}

func (s *Store) Metrics(ctx context.Context, agentID string, from, to int64) ([]MetricRow, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT ts, cpu, mem, rx_rate, tx_rate FROM metrics_minute WHERE agent_id=? AND ts>=? AND ts<? ORDER BY ts", agentID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MetricRow{}
	for rows.Next() {
		var m MetricRow
		if err := rows.Scan(&m.TS, &m.CPU, &m.Mem, &m.RxRate, &m.TxRate); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) PruneMetrics(ctx context.Context, before int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM metrics_minute WHERE ts<?", before)
	return err
}

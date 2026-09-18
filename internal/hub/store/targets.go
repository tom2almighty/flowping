package store

import (
	"context"
	"database/sql"
)

type Target struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Host      string   `json:"host"`
	Port      int      `json:"port"`
	Interval  int      `json:"interval"`
	Count     int      `json:"count"`
	TimeoutMS int      `json:"timeout_ms"`
	AllAgents bool     `json:"all_agents"`
	AgentIDs  []string `json:"agent_ids"`
	Enabled   bool     `json:"enabled"`
	SortOrder int      `json:"sort_order"`
	CreatedAt int64    `json:"created_at"`
}

const targetCols = "id, name, host, port, interval_sec, count, timeout_ms, all_agents, enabled, sort_order, created_at"

func scanTarget(sc scanner) (Target, error) {
	var t Target
	err := sc.Scan(&t.ID, &t.Name, &t.Host, &t.Port, &t.Interval, &t.Count, &t.TimeoutMS, &t.AllAgents, &t.Enabled, &t.SortOrder, &t.CreatedAt)
	t.AgentIDs = []string{}
	return t, err
}

func (s *Store) ListTargets(ctx context.Context) ([]Target, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+targetCols+" FROM targets ORDER BY sort_order, created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byID := map[string]int{}
	out := []Target{}
	for rows.Next() {
		t, err := scanTarget(rows)
		if err != nil {
			return nil, err
		}
		byID[t.ID] = len(out)
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	links, err := s.db.QueryContext(ctx, "SELECT target_id, agent_id FROM target_agents")
	if err != nil {
		return nil, err
	}
	defer links.Close()
	for links.Next() {
		var tid, aid string
		if err := links.Scan(&tid, &aid); err != nil {
			return nil, err
		}
		if i, ok := byID[tid]; ok {
			out[i].AgentIDs = append(out[i].AgentIDs, aid)
		}
	}
	return out, links.Err()
}

func (s *Store) GetTarget(ctx context.Context, id string) (Target, error) {
	t, err := scanTarget(s.db.QueryRowContext(ctx, "SELECT "+targetCols+" FROM targets WHERE id=?", id))
	if err != nil {
		return t, notFound(err)
	}
	rows, err := s.db.QueryContext(ctx, "SELECT agent_id FROM target_agents WHERE target_id=?", id)
	if err != nil {
		return t, err
	}
	defer rows.Close()
	for rows.Next() {
		var aid string
		if err := rows.Scan(&aid); err != nil {
			return t, err
		}
		t.AgentIDs = append(t.AgentIDs, aid)
	}
	return t, rows.Err()
}

func (s *Store) SaveTarget(ctx context.Context, t Target, create bool) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		if create {
			_, err = tx.ExecContext(ctx, "INSERT INTO targets ("+targetCols+") VALUES (?,?,?,?,?,?,?,?,?,?,?)",
				t.ID, t.Name, t.Host, t.Port, t.Interval, t.Count, t.TimeoutMS, t.AllAgents, t.Enabled, t.SortOrder, t.CreatedAt)
		} else {
			var res sql.Result
			res, err = tx.ExecContext(ctx, "UPDATE targets SET name=?, host=?, port=?, interval_sec=?, count=?, timeout_ms=?, all_agents=?, enabled=?, sort_order=? WHERE id=?",
				t.Name, t.Host, t.Port, t.Interval, t.Count, t.TimeoutMS, t.AllAgents, t.Enabled, t.SortOrder, t.ID)
			if err == nil {
				if n, _ := res.RowsAffected(); n == 0 {
					return ErrNotFound
				}
			}
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM target_agents WHERE target_id=?", t.ID); err != nil {
			return err
		}
		for _, aid := range t.AgentIDs {
			if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO target_agents (target_id, agent_id) VALUES (?,?)", t.ID, aid); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) DeleteTarget(ctx context.Context, id string) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for _, q := range []string{
			"DELETE FROM target_agents WHERE target_id=?",
			"DELETE FROM ping_raw WHERE target_id=?",
			"DELETE FROM ping_5m WHERE target_id=?",
			"DELETE FROM ping_1h WHERE target_id=?",
		} {
			if _, err := tx.ExecContext(ctx, q, id); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, "DELETE FROM targets WHERE id=?", id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// TargetsForAgent returns the enabled targets an agent should probe.
func (s *Store) TargetsForAgent(ctx context.Context, agentID string) ([]Target, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+targetCols+` FROM targets t WHERE enabled=1 AND (all_agents=1 OR EXISTS (
SELECT 1 FROM target_agents ta WHERE ta.target_id=t.id AND ta.agent_id=?)) ORDER BY sort_order, created_at`, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Target{}
	for rows.Next() {
		t, err := scanTarget(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

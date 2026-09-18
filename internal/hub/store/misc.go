package store

import (
	"context"
	"database/sql"
	"time"
)

// ---- settings ----

func (s *Store) Setting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, "SELECT value FROM settings WHERE key=?", key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value)
	return err
}

func (s *Store) AllSettings(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// ---- notification channels ----

type Channel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	Enabled   bool   `json:"enabled"`
	CreatedAt int64  `json:"created_at"`
}

func (s *Store) ListChannels(ctx context.Context) ([]Channel, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, url, enabled, created_at FROM channels ORDER BY created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Channel{}
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.ID, &c.Name, &c.URL, &c.Enabled, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) GetChannel(ctx context.Context, id string) (Channel, error) {
	var c Channel
	err := s.db.QueryRowContext(ctx, "SELECT id, name, url, enabled, created_at FROM channels WHERE id=?", id).Scan(&c.ID, &c.Name, &c.URL, &c.Enabled, &c.CreatedAt)
	return c, notFound(err)
}

func (s *Store) SaveChannel(ctx context.Context, c Channel, create bool) error {
	if create {
		_, err := s.db.ExecContext(ctx, "INSERT INTO channels (id, name, url, enabled, created_at) VALUES (?,?,?,?,?)", c.ID, c.Name, c.URL, c.Enabled, c.CreatedAt)
		return err
	}
	res, err := s.db.ExecContext(ctx, "UPDATE channels SET name=?, url=?, enabled=? WHERE id=?", c.Name, c.URL, c.Enabled, c.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteChannel(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM channels WHERE id=?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- alert state ----

type AlertState struct {
	Active       bool
	Since        int64
	LastNotified int64
}

func (s *Store) LoadAlertStates(ctx context.Context) (map[[2]string]AlertState, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT agent_id, kind, active, since, last_notified FROM alert_state")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[[2]string]AlertState{}
	for rows.Next() {
		var aid, kind string
		var st AlertState
		if err := rows.Scan(&aid, &kind, &st.Active, &st.Since, &st.LastNotified); err != nil {
			return nil, err
		}
		out[[2]string{aid, kind}] = st
	}
	return out, rows.Err()
}

func (s *Store) SaveAlertState(ctx context.Context, agentID, kind string, st AlertState) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO alert_state (agent_id, kind, active, since, last_notified) VALUES (?,?,?,?,?)
ON CONFLICT(agent_id, kind) DO UPDATE SET active=excluded.active, since=excluded.since, last_notified=excluded.last_notified`,
		agentID, kind, st.Active, st.Since, st.LastNotified)
	return err
}

// ---- events ----

type Event struct {
	ID      int64  `json:"id"`
	TS      int64  `json:"ts"`
	AgentID string `json:"agent_id"`
	Kind    string `json:"kind"`
	Level   string `json:"level"` // info|warning|critical
	Message string `json:"message"`
}

func (s *Store) AddEvent(ctx context.Context, e Event) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO events (ts, agent_id, kind, level, message) VALUES (?,?,?,?,?)", e.TS, e.AgentID, e.Kind, e.Level, e.Message)
	return err
}

func (s *Store) ListEvents(ctx context.Context, limit int) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, ts, agent_id, kind, level, message FROM events ORDER BY id DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.TS, &e.AgentID, &e.Kind, &e.Level, &e.Message); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) PruneEvents(ctx context.Context, before int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM events WHERE ts<?", before)
	return err
}

// ---- sessions ----

func (s *Store) CreateSession(ctx context.Context, id, user string, ttl time.Duration) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx, "INSERT INTO sessions (id, username, created_at, expires_at) VALUES (?,?,?,?)", id, user, now.Unix(), now.Add(ttl).Unix())
	return err
}

// SessionUser returns the user for a live session, or "" if none.
func (s *Store) SessionUser(ctx context.Context, id string) (string, error) {
	var user string
	err := s.db.QueryRowContext(ctx, "SELECT username FROM sessions WHERE id=? AND expires_at>?", id, time.Now().Unix()).Scan(&user)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return user, err
}

func (s *Store) DeleteSession(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE id=?", id)
	return err
}

func (s *Store) PruneSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<?", time.Now().Unix())
	return err
}

// ---- api tokens ----

type APIToken struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	LastUsed  int64  `json:"last_used"`
}

func (s *Store) CreateAPIToken(ctx context.Context, t APIToken, hash string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?,?,?,?)", t.ID, t.Name, hash, t.CreatedAt)
	return err
}

func (s *Store) ListAPITokens(ctx context.Context) ([]APIToken, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, created_at, last_used FROM api_tokens ORDER BY created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		var t APIToken
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.LastUsed); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) DeleteAPIToken(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM api_tokens WHERE id=?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// TouchAPIToken returns whether a token with this hash exists and records use.
func (s *Store) TouchAPIToken(ctx context.Context, hash string) (bool, error) {
	res, err := s.db.ExecContext(ctx, "UPDATE api_tokens SET last_used=? WHERE token_hash=?", time.Now().Unix(), hash)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

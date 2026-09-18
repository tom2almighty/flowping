// Package store is the only place that talks SQL. Keeping every query here is
// what makes a PostgreSQL backend a contained change later.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	db *sql.DB
}

func Open(dir string) (*Store, error) {
	abs, err := filepath.Abs(filepath.Join(dir, "flowping.db"))
	if err != nil {
		return nil, err
	}
	dsn := fmt.Sprintf("file:%s?_txlock=immediate&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)", abs)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// DatabaseStats reports the file size and how many bytes sit in free pages,
// which is exactly what VACUUM would hand back.
func (s *Store) DatabaseStats(ctx context.Context) (size, reclaimable int64, err error) {
	var pageSize, pageCount, freelist int64
	if err = s.db.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		return 0, 0, err
	}
	if err = s.db.QueryRowContext(ctx, "PRAGMA page_count").Scan(&pageCount); err != nil {
		return 0, 0, err
	}
	if err = s.db.QueryRowContext(ctx, "PRAGMA freelist_count").Scan(&freelist); err != nil {
		return 0, 0, err
	}
	return pageSize * pageCount, pageSize * freelist, nil
}

// Vacuum rewrites the file compactly. The retention jobs delete a lot of rows,
// and SQLite leaves the freed pages in place until this runs.
func (s *Store) Vacuum(ctx context.Context) error {
	var busy, logFrames, checkpointed int64
	if err := s.db.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &checkpointed); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, "VACUUM"); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, "PRAGMA optimize")
	return err
}

// Tx runs fn inside a write transaction.
func (s *Store) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

var migrations = []string{`
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  tz TEXT NOT NULL DEFAULT '',
  tz_offset INTEGER NOT NULL DEFAULT 0,
  iface TEXT NOT NULL DEFAULT '',
  interval_sec INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  billing_cycle TEXT NOT NULL DEFAULT 'free',
  billing_days INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  expires_at TEXT NOT NULL DEFAULT '',
  auto_renew INTEGER NOT NULL DEFAULT 0,
  traffic_quota INTEGER NOT NULL DEFAULT 0,
  traffic_reset_day INTEGER NOT NULL DEFAULT 1,
  traffic_mode TEXT NOT NULL DEFAULT 'both',
  hostname TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  kernel TEXT NOT NULL DEFAULT '',
  arch TEXT NOT NULL DEFAULT '',
  cpus INTEGER NOT NULL DEFAULT 0,
  agent_version TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_counters (
  agent_id TEXT PRIMARY KEY,
  boot_id TEXT NOT NULL,
  iface TEXT NOT NULL,
  rx INTEGER NOT NULL,
  tx INTEGER NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE traffic_hourly (
  agent_id TEXT NOT NULL,
  hour INTEGER NOT NULL,
  rx INTEGER NOT NULL DEFAULT 0,
  tx INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, hour)
);

CREATE TABLE traffic_daily (
  agent_id TEXT NOT NULL,
  day TEXT NOT NULL,
  rx INTEGER NOT NULL DEFAULT 0,
  tx INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day)
);

CREATE TABLE metrics_minute (
  agent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  cpu REAL NOT NULL,
  mem REAL NOT NULL,
  rx_rate REAL NOT NULL,
  tx_rate REAL NOT NULL,
  PRIMARY KEY (agent_id, ts)
);

CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  interval_sec INTEGER NOT NULL DEFAULT 60,
  count INTEGER NOT NULL DEFAULT 20,
  timeout_ms INTEGER NOT NULL DEFAULT 2000,
  all_agents INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE target_agents (
  target_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (target_id, agent_id)
);

CREATE TABLE ping_raw (
  agent_id TEXT NOT NULL, target_id TEXT NOT NULL, ts INTEGER NOT NULL,
  sent INTEGER NOT NULL, recv INTEGER NOT NULL,
  min REAL, p25 REAL, p50 REAL, p75 REAL, max REAL, avg REAL,
  PRIMARY KEY (agent_id, target_id, ts)
);
CREATE INDEX ping_raw_ts ON ping_raw (ts);

CREATE TABLE ping_5m (
  agent_id TEXT NOT NULL, target_id TEXT NOT NULL, ts INTEGER NOT NULL,
  sent INTEGER NOT NULL, recv INTEGER NOT NULL,
  min REAL, p25 REAL, p50 REAL, p75 REAL, max REAL, avg REAL,
  PRIMARY KEY (agent_id, target_id, ts)
);
CREATE INDEX ping_5m_ts ON ping_5m (ts);

CREATE TABLE ping_1h (
  agent_id TEXT NOT NULL, target_id TEXT NOT NULL, ts INTEGER NOT NULL,
  sent INTEGER NOT NULL, recv INTEGER NOT NULL,
  min REAL, p25 REAL, p50 REAL, p75 REAL, max REAL, avg REAL,
  PRIMARY KEY (agent_id, target_id, ts)
);
CREATE INDEX ping_1h_ts ON ping_1h (ts);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE alert_state (
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  since INTEGER NOT NULL DEFAULT 0,
  last_notified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, kind)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  agent_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX events_ts ON events (ts);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL DEFAULT 0
);
`, `
ALTER TABLE agents ADD COLUMN country_auto INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agents ADD COLUMN country_ip TEXT NOT NULL DEFAULT '';
`}

func (s *Store) migrate(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	for i := version; i < len(migrations); i++ {
		err := s.Tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", i+1))
			return err
		})
		if err != nil {
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
	}
	return nil
}

type scanner interface{ Scan(dest ...any) error }

// placeholders builds the "?,?,?" list for a column list, so the two cannot
// drift apart when a column is added.
func placeholders(cols string) string {
	n := strings.Count(cols, ",") + 1
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

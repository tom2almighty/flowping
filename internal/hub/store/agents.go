package store

import (
	"context"
	"database/sql"
	"time"
)

type Billing struct {
	Cycle     string  `json:"cycle"` // free|lifetime|monthly|quarterly|semiannual|yearly|custom
	Days      int     `json:"days"`  // cycle length when Cycle is custom
	Price     float64 `json:"price"`
	Currency  string  `json:"currency"`
	ExpiresAt string  `json:"expires_at"` // YYYY-MM-DD, empty = never
	AutoRenew bool    `json:"auto_renew"` // roll ExpiresAt forward by one cycle once it passes
	Quota     int64   `json:"quota"`      // bytes per traffic period, 0 = unlimited
	ResetDay  int     `json:"reset_day"`  // day of month the traffic period starts
	Mode      string  `json:"mode"`       // both|rx|tx|max
}

type Agent struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Token        string  `json:"token"`
	Note         string  `json:"note"`
	Country      string  `json:"country"`
	CountryAuto  bool    `json:"country_auto"` // the country came from the IP resolver, so it may be replaced
	CountryIP    string  `json:"country_ip"`   // the address that country was derived from
	IP           string  `json:"ip"`
	TZ           string  `json:"tz"`
	TZOffset     int     `json:"tz_offset"`
	Iface        string  `json:"iface"`
	Interval     int     `json:"interval"`
	SortOrder    int     `json:"sort_order"`
	Hidden       bool    `json:"hidden"`
	Billing      Billing `json:"billing"`
	Hostname     string  `json:"hostname"`
	OS           string  `json:"os"`
	Kernel       string  `json:"kernel"`
	Arch         string  `json:"arch"`
	CPUs         int     `json:"cpus"`
	AgentVersion string  `json:"agent_version"`
	LastSeen     int64   `json:"last_seen"`
	CreatedAt    int64   `json:"created_at"`
	UpdatedAt    int64   `json:"updated_at"`
}

// Location resolves the agent's zone: the IANA name when the hub knows it,
// otherwise the fixed offset the agent reported.
func (a Agent) Location() *time.Location {
	if a.TZ != "" {
		if loc, err := time.LoadLocation(a.TZ); err == nil {
			return loc
		}
	}
	return time.FixedZone("agent", a.TZOffset)
}

const agentCols = `id, name, token, note, country, country_auto, country_ip, ip, tz, tz_offset, iface, interval_sec, sort_order, hidden,
billing_cycle, billing_days, price, currency, expires_at, auto_renew, traffic_quota, traffic_reset_day, traffic_mode,
hostname, os, kernel, arch, cpus, agent_version, last_seen, created_at, updated_at`

func scanAgent(sc scanner) (Agent, error) {
	var a Agent
	err := sc.Scan(&a.ID, &a.Name, &a.Token, &a.Note, &a.Country, &a.CountryAuto, &a.CountryIP, &a.IP, &a.TZ, &a.TZOffset, &a.Iface, &a.Interval, &a.SortOrder, &a.Hidden,
		&a.Billing.Cycle, &a.Billing.Days, &a.Billing.Price, &a.Billing.Currency, &a.Billing.ExpiresAt, &a.Billing.AutoRenew, &a.Billing.Quota, &a.Billing.ResetDay, &a.Billing.Mode,
		&a.Hostname, &a.OS, &a.Kernel, &a.Arch, &a.CPUs, &a.AgentVersion, &a.LastSeen, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func (s *Store) ListAgents(ctx context.Context) ([]Agent, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+agentCols+" FROM agents ORDER BY sort_order, created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Agent{}
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) GetAgent(ctx context.Context, id string) (Agent, error) {
	a, err := scanAgent(s.db.QueryRowContext(ctx, "SELECT "+agentCols+" FROM agents WHERE id = ?", id))
	return a, notFound(err)
}

func (s *Store) AgentByToken(ctx context.Context, token string) (Agent, error) {
	a, err := scanAgent(s.db.QueryRowContext(ctx, "SELECT "+agentCols+" FROM agents WHERE token = ?", token))
	return a, notFound(err)
}

func (s *Store) CreateAgent(ctx context.Context, a Agent) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO agents ("+agentCols+") VALUES ("+placeholders(agentCols)+")",
		a.ID, a.Name, a.Token, a.Note, a.Country, a.CountryAuto, a.CountryIP, a.IP, a.TZ, a.TZOffset, a.Iface, a.Interval, a.SortOrder, a.Hidden,
		a.Billing.Cycle, a.Billing.Days, a.Billing.Price, a.Billing.Currency, a.Billing.ExpiresAt, a.Billing.AutoRenew, a.Billing.Quota, a.Billing.ResetDay, a.Billing.Mode,
		a.Hostname, a.OS, a.Kernel, a.Arch, a.CPUs, a.AgentVersion, a.LastSeen, a.CreatedAt, a.UpdatedAt)
	return err
}

// UpdateAgent writes the operator-editable fields. country_auto is included so
// that clearing the field hands it back to the resolver and typing a code takes
// it over for good.
func (s *Store) UpdateAgent(ctx context.Context, a Agent) error {
	res, err := s.db.ExecContext(ctx, `UPDATE agents SET name=?, note=?, country=?, country_auto=?, country_ip=?, iface=?, interval_sec=?, sort_order=?, hidden=?,
billing_cycle=?, billing_days=?, price=?, currency=?, expires_at=?, auto_renew=?, traffic_quota=?, traffic_reset_day=?, traffic_mode=?, updated_at=?
WHERE id=?`,
		a.Name, a.Note, a.Country, a.CountryAuto, a.CountryIP, a.Iface, a.Interval, a.SortOrder, a.Hidden,
		a.Billing.Cycle, a.Billing.Days, a.Billing.Price, a.Billing.Currency, a.Billing.ExpiresAt, a.Billing.AutoRenew, a.Billing.Quota, a.Billing.ResetDay, a.Billing.Mode, a.UpdatedAt,
		a.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetAutoCountry stores a resolved country, but only while the value is still
// the resolver's to own.
func (s *Store) SetAutoCountry(ctx context.Context, id, country, ip string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE agents SET country=?, country_ip=? WHERE id=? AND country_auto=1", country, ip, id)
	return err
}

func (s *Store) SetAgentToken(ctx context.Context, id, token string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE agents SET token=?, updated_at=? WHERE id=?", token, time.Now().Unix(), id)
	return err
}

func (s *Store) SetAgentExpiry(ctx context.Context, id, expiresAt string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE agents SET expires_at=? WHERE id=?", expiresAt, id)
	return err
}

// ReorderAgents writes sort_order from the slice position, which is what the
// admin list's drag-and-drop sends.
func (s *Store) ReorderAgents(ctx context.Context, ids []string) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for i, id := range ids {
			if _, err := tx.ExecContext(ctx, "UPDATE agents SET sort_order=? WHERE id=?", i, id); err != nil {
				return err
			}
		}
		return nil
	})
}

// AgentFacts are the fields the agent itself reports; they are persisted so
// the page still shows them while the agent is offline.
type AgentFacts struct {
	IP           string
	TZ           string
	TZOffset     int
	Hostname     string
	OS           string
	Kernel       string
	Arch         string
	CPUs         int
	AgentVersion string
	LastSeen     int64
}

func (s *Store) UpdateAgentFacts(ctx context.Context, tx *sql.Tx, id string, f AgentFacts) error {
	_, err := tx.ExecContext(ctx, `UPDATE agents SET ip=?, tz=?, tz_offset=?, hostname=?, os=?, kernel=?, arch=?, cpus=?, agent_version=?, last_seen=? WHERE id=?`,
		f.IP, f.TZ, f.TZOffset, f.Hostname, f.OS, f.Kernel, f.Arch, f.CPUs, f.AgentVersion, f.LastSeen, id)
	return err
}

func (s *Store) DeleteAgent(ctx context.Context, id string) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		for _, q := range []string{
			"DELETE FROM agent_counters WHERE agent_id=?",
			"DELETE FROM traffic_hourly WHERE agent_id=?",
			"DELETE FROM traffic_daily WHERE agent_id=?",
			"DELETE FROM metrics_minute WHERE agent_id=?",
			"DELETE FROM ping_raw WHERE agent_id=?",
			"DELETE FROM ping_5m WHERE agent_id=?",
			"DELETE FROM ping_1h WHERE agent_id=?",
			"DELETE FROM target_agents WHERE agent_id=?",
			"DELETE FROM alert_state WHERE agent_id=?",
		} {
			if _, err := tx.ExecContext(ctx, q, id); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, "DELETE FROM agents WHERE id=?", id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// Counter is the last raw kernel counter seen for an agent; deltas against it
// become traffic buckets.
type Counter struct {
	BootID string
	Iface  string
	Rx, Tx uint64
	At     int64
}

func (s *Store) LoadCounters(ctx context.Context) (map[string]Counter, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT agent_id, boot_id, iface, rx, tx, at FROM agent_counters")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Counter{}
	for rows.Next() {
		var id string
		var c Counter
		var rx, tx int64
		if err := rows.Scan(&id, &c.BootID, &c.Iface, &rx, &tx, &c.At); err != nil {
			return nil, err
		}
		c.Rx, c.Tx = uint64(rx), uint64(tx)
		out[id] = c
	}
	return out, rows.Err()
}

func (s *Store) SaveCounter(ctx context.Context, tx *sql.Tx, id string, c Counter) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO agent_counters (agent_id, boot_id, iface, rx, tx, at) VALUES (?,?,?,?,?,?)
ON CONFLICT(agent_id) DO UPDATE SET boot_id=excluded.boot_id, iface=excluded.iface, rx=excluded.rx, tx=excluded.tx, at=excluded.at`,
		id, c.BootID, c.Iface, int64(c.Rx), int64(c.Tx), c.At)
	return err
}

// Package geoip turns an agent's IP address into a country code. It keeps the
// source of that answer pluggable, because the trade-offs are real: an online
// lookup needs no data on disk but hands every agent IP to a third party, while
// a local database is private and exact but is one more file to keep fresh.
package geoip

import (
	"context"
	"log/slog"
	"net/netip"
	"os"
	"sync"
	"time"
)

// Provider resolves one IP. Implementations must be safe for concurrent Lookup.
type Provider interface {
	Name() string
	Lookup(addr netip.Addr) (string, error)
	// Update refreshes whatever data the provider keeps locally. Providers that
	// ask a remote service have nothing to refresh.
	Update(ctx context.Context) error
	Close() error
}

// Sources, as stored in settings.
const (
	SourceOff    = "off"
	SourceOnline = "online"
	SourceMMDB   = "mmdb"
)

const (
	cacheTTL   = 24 * time.Hour
	cacheMax   = 20000
	refreshAge = 30 * 24 * time.Hour
	retryAfter = time.Hour
)

type Config struct {
	Source string
	URL    string // where to fetch the database from, when Source is mmdb
	Path   string // where the database lives
}

// Status is what the admin page shows for the current source.
type Status struct {
	Source    string `json:"source"`
	Provider  string `json:"provider"`
	URL       string `json:"url"`
	Ready     bool   `json:"ready"`
	Size      int64  `json:"size"`
	UpdatedAt int64  `json:"updated_at"`
	Error     string `json:"error,omitempty"`
}

type entry struct {
	code    string
	expires time.Time
}

// Resolver owns the active provider, the per-IP cache and the download state.
type Resolver struct {
	log *slog.Logger

	mu       sync.RWMutex
	cfg      Config
	provider Provider
	cache    map[string]entry
	lastErr  string
	lastTry  time.Time
}

func New(log *slog.Logger) *Resolver {
	return &Resolver{log: log, cache: map[string]entry{}}
}

// Configure switches the active provider. Reconfiguring with the same source
// and URL is a no-op, so it is safe to call on every settings write.
func (r *Resolver) Configure(cfg Config) {
	r.mu.Lock()
	if r.provider != nil && r.cfg == cfg {
		r.mu.Unlock()
		return
	}
	old := r.provider
	r.cfg = cfg
	switch cfg.Source {
	case SourceMMDB:
		r.provider = newMMDB(cfg.Path, cfg.URL, r.log)
	case SourceOnline:
		r.provider = newOnline()
	default:
		r.provider = nil
	}
	r.cache = map[string]entry{}
	r.lastErr = ""
	r.mu.Unlock()

	if old != nil {
		_ = old.Close()
	}
	if cfg.Source == SourceMMDB && !r.ready() {
		// A missing database is normal on first run; fetch it in the background
		// so the admin page is not blocked on an 8 MB download.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			if err := r.Update(ctx); err != nil {
				r.log.Warn("geoip database fetch failed", "err", err)
			}
		}()
	}
}

// Lookup returns the lower-case ISO country code, or "" when it cannot be
// determined. Failures are logged inside: a failed lookup must never keep an
// agent's report from being stored.
func (r *Resolver) Lookup(ctx context.Context, ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil || !routable(addr) {
		return ""
	}
	key := addr.Unmap().String()

	r.mu.RLock()
	if e, ok := r.cache[key]; ok && time.Now().Before(e.expires) {
		r.mu.RUnlock()
		return e.code
	}
	p := r.provider
	r.mu.RUnlock()
	if p == nil {
		return ""
	}

	code, err := p.Lookup(addr)
	if err != nil {
		r.log.Debug("geoip lookup failed", "ip", key, "provider", p.Name(), "err", err)
		return ""
	}
	if code == "" {
		return ""
	}

	r.mu.Lock()
	if len(r.cache) >= cacheMax {
		r.cache = map[string]entry{}
	}
	r.cache[key] = entry{code: code, expires: time.Now().Add(cacheTTL)}
	r.mu.Unlock()
	return code
}

// Update refreshes the provider's data and drops the cache, since every cached
// answer may have been derived from the old data.
func (r *Resolver) Update(ctx context.Context) error {
	r.mu.Lock()
	p := r.provider
	r.lastTry = time.Now()
	r.mu.Unlock()
	if p == nil {
		return nil
	}
	err := p.Update(ctx)
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil {
		r.lastErr = err.Error()
		return err
	}
	r.lastErr = ""
	r.cache = map[string]entry{}
	return nil
}

// MaybeRefresh is called from the housekeeping job: local data is refetched
// once it is a month old, and a failed attempt is not retried for an hour.
func (r *Resolver) MaybeRefresh(ctx context.Context) {
	r.mu.RLock()
	stale := r.cfg.Source == SourceMMDB && (r.provider == nil || !r.readyLocked() || r.older(refreshAge))
	retry := time.Since(r.lastTry) < retryAfter
	r.mu.RUnlock()
	if !stale || retry {
		return
	}
	if err := r.Update(ctx); err != nil {
		r.log.Warn("geoip database update failed", "err", err)
	}
}

func (r *Resolver) Status() Status {
	r.mu.RLock()
	defer r.mu.RUnlock()
	st := Status{Source: r.cfg.Source, URL: r.cfg.URL, Error: r.lastErr}
	if r.provider != nil {
		st.Provider = r.provider.Name()
	}
	switch r.cfg.Source {
	case SourceMMDB:
		if f, err := os.Stat(r.cfg.Path); err == nil {
			st.Size = f.Size()
			st.UpdatedAt = f.ModTime().Unix()
		}
		// A file on disk is not enough: it has to have opened.
		st.Ready = r.readyLocked()
	case SourceOnline:
		st.Ready = true
	}
	return st
}

func (r *Resolver) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.provider == nil {
		return nil
	}
	err := r.provider.Close()
	r.provider = nil
	return err
}

func (r *Resolver) ready() bool {
	if r.cfg.Source != SourceMMDB {
		return true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.readyLocked()
}

// readyLocked reports whether the local database is usable. The caller holds mu.
func (r *Resolver) readyLocked() bool {
	if r.provider == nil {
		return false
	}
	p, ok := r.provider.(*mmdb)
	return ok && p.loaded()
}

// older reports whether the local database is past its refresh age.
func (r *Resolver) older(age time.Duration) bool {
	f, err := os.Stat(r.cfg.Path)
	if err != nil {
		return true
	}
	return time.Since(f.ModTime()) > age
}

// routable filters out addresses no country database can answer for.
func routable(addr netip.Addr) bool {
	return addr.IsValid() && addr.IsGlobalUnicast() && !addr.IsPrivate() &&
		!addr.IsLoopback() && !addr.IsLinkLocalUnicast() && !addr.IsUnspecified()
}

package hub

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/geoip"
	"github.com/tom2almighty/flowping/internal/hub/store"
)

var defaultSettings = map[string]string{
	"site_name":        "FlowPing",
	"public":           "true",
	"theme":            "",
	"theme_market_url": "https://raw.githubusercontent.com/tom2almighty/flowping-themes/main/index.json",
	"github_users":     "",
	"geoip_provider":   "online",
	"geoip_url":        "https://raw.githubusercontent.com/Loyalsoldier/geoip/release/GeoLite2-Country.mmdb",
	"notify_offline":   "true",
	"offline_grace":    "60",
	"cpu_pct":          "90",
	"mem_pct":          "90",
	"disk_pct":         "90",
	"load_grace":       "300",
	"loss_pct":         "20",
	"latency_ms":       "0",
	"ping_grace":       "300",
	"traffic_pct":      "90",
	"expire_days":      "7",
}

type Hub struct {
	cfg     Config
	log     *slog.Logger
	db      *store.Store
	st      *state
	alerts  *alertEngine
	version string
	cfgVer  atomic.Int64

	settingsMu sync.RWMutex
	settings   map[string]string

	locs  sync.Map // tz name -> *time.Location
	geo   *geoip.Resolver
	login *limiter
}

func New(cfg Config, log *slog.Logger, version string) (*Hub, error) {
	ctx := context.Background()
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "themes"), 0o755); err != nil {
		return nil, err
	}
	db, err := store.Open(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}
	counters, err := db.LoadCounters(ctx)
	if err != nil {
		return nil, err
	}
	h := &Hub{
		cfg:     cfg,
		log:     log,
		db:      db,
		st:      newState(counters),
		version: version,
		login:   newLimiter(10, 10*time.Minute),
	}
	h.cfgVer.Store(time.Now().Unix())
	if err := h.reloadSettings(ctx); err != nil {
		return nil, err
	}
	h.geo = geoip.New(log)
	h.geo.Configure(h.geoipConfig())
	if err := h.ensureAdminPassword(ctx); err != nil {
		return nil, err
	}
	states, err := db.LoadAlertStates(ctx)
	if err != nil {
		return nil, err
	}
	h.alerts = newAlertEngine(h, states)
	return h, nil
}

func (h *Hub) Run(ctx context.Context) error {
	srv := &http.Server{Addr: h.cfg.Listen, Handler: h.routes(), ReadHeaderTimeout: 10 * time.Second}
	jobsDone := make(chan struct{})
	go func() {
		h.runJobs(ctx)
		close(jobsDone)
	}()
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	h.log.Info("hub listening", "addr", h.cfg.Listen, "version", h.version, "data", h.cfg.DataDir)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	<-jobsDone
	_ = h.geo.Close()
	return h.db.Close()
}

func (h *Hub) reloadSettings(ctx context.Context) error {
	m, err := h.db.AllSettings(ctx)
	if err != nil {
		return err
	}
	h.settingsMu.Lock()
	h.settings = m
	h.settingsMu.Unlock()
	return nil
}

func (h *Hub) setting(key string) string {
	h.settingsMu.RLock()
	v, ok := h.settings[key]
	h.settingsMu.RUnlock()
	if !ok {
		return defaultSettings[key]
	}
	return v
}

func (h *Hub) settingInt(key string) int {
	v, _ := strconv.Atoi(h.setting(key))
	return v
}

func (h *Hub) settingFloat(key string) float64 {
	v, _ := strconv.ParseFloat(h.setting(key), 64)
	return v
}

func (h *Hub) bumpConfig() { h.cfgVer.Store(time.Now().UnixNano()) }

func (h *Hub) ensureAdminPassword(ctx context.Context) error {
	if h.setting("admin_password_hash") != "" {
		return nil
	}
	pw := h.cfg.AdminPassword
	generated := false
	if pw == "" {
		pw = newToken("")[:16]
		generated = true
	}
	if err := h.db.SetSetting(ctx, "admin_password_hash", hashPassword(pw)); err != nil {
		return err
	}
	if generated {
		h.log.Warn("no admin password configured, generated one (printed to stderr)")
		fmt.Fprintf(os.Stderr, "\n  Admin password: %s\n  (set FLOWPING_ADMIN_PASSWORD to choose one; change it later in Settings)\n\n", pw)
	}
	return h.reloadSettings(ctx)
}

// location resolves a zone reported by an agent, caching successful lookups.
func (h *Hub) location(name string, offset int) *time.Location {
	if name != "" {
		if v, ok := h.locs.Load(name); ok {
			return v.(*time.Location)
		}
		if loc, err := time.LoadLocation(name); err == nil {
			h.locs.Store(name, loc)
			return loc
		}
	}
	return time.FixedZone("agent", offset)
}

// baseURL is the public address of the hub for links handed to agents.
func (h *Hub) baseURL(r *http.Request) string {
	if h.cfg.BaseURL != "" {
		return h.cfg.BaseURL
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

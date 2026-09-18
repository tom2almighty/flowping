package hub

import (
	"context"
	"path/filepath"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/geoip"
	"github.com/tom2almighty/flowping/internal/hub/store"
)

// geoipConfig maps the stored settings onto a resolver configuration.
func (h *Hub) geoipConfig() geoip.Config {
	return geoip.Config{
		Source: h.setting("geoip_provider"),
		URL:    h.setting("geoip_url"),
		Path:   filepath.Join(h.cfg.DataDir, "geoip.mmdb"),
	}
}

// needsCountry reports whether the stored country is missing, or was derived
// from a different address than the one just seen. A country the operator typed
// by hand is never touched.
func needsCountry(a store.Agent, ip string) bool {
	if ip == "" {
		return false
	}
	if a.Country == "" {
		return true
	}
	return a.CountryAuto && a.CountryIP != ip
}

// resolveCountry asks the configured source and records the answer. It runs off
// the request path: an agent's report must never wait on a third party.
func (h *Hub) resolveCountry(agentID, ip string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	code := h.geo.Lookup(ctx, ip)
	if code == "" {
		return
	}
	if err := h.db.SetAutoCountry(ctx, agentID, code, ip); err != nil {
		h.log.Error("store country", "agent", agentID, "err", err)
	}
}

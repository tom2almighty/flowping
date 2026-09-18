package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

type geoCache struct {
	mu    sync.Mutex
	tried map[string]time.Time
}

// lookupCountry resolves ip to an ISO country code and stores it on the agent
// unless the operator already set one. Failed lookups are retried hourly.
func (h *Hub) lookupCountry(agentID, ip string) {
	if isPrivateIP(ip) {
		return
	}
	h.geo.mu.Lock()
	if h.geo.tried == nil {
		h.geo.tried = map[string]time.Time{}
	}
	if t, ok := h.geo.tried[agentID+"|"+ip]; ok && time.Since(t) < time.Hour {
		h.geo.mu.Unlock()
		return
	}
	h.geo.tried[agentID+"|"+ip] = time.Now()
	h.geo.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cc := geoIPWho(ctx, ip)
	if cc == "" {
		cc = geoIPAPI(ctx, ip)
	}
	if cc == "" {
		h.log.Warn("country lookup failed", "ip", ip)
		return
	}
	if err := h.db.SetAgentCountry(ctx, agentID, strings.ToLower(cc)); err != nil {
		h.log.Error("store country", "err", err)
	}
}

func geoIPWho(ctx context.Context, ip string) string {
	var out struct {
		Success     bool   `json:"success"`
		CountryCode string `json:"country_code"`
	}
	if geoGet(ctx, "https://ipwho.is/"+ip+"?fields=success,country_code", &out) != nil || !out.Success {
		return ""
	}
	return out.CountryCode
}

func geoIPAPI(ctx context.Context, ip string) string {
	var out struct {
		Status      string `json:"status"`
		CountryCode string `json:"countryCode"`
	}
	if geoGet(ctx, "http://ip-api.com/json/"+ip+"?fields=status,countryCode", &out) != nil || out.Status != "success" {
		return ""
	}
	return out.CountryCode
}

func geoGet(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "flowping-hub")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(v)
}

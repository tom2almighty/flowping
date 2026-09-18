package hub

import (
	"database/sql"
	"errors"
	"net/http"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
	"github.com/tom2almighty/flowping/internal/proto"
)

func (h *Hub) routes() http.Handler {
	mux := http.NewServeMux()

	// agent
	mux.HandleFunc("POST /api/v1/agent/report", h.agentAuth(h.handleReport))
	mux.HandleFunc("GET /api/v1/agent/config", h.agentAuth(h.handleAgentConfig))

	// read
	mux.HandleFunc("GET /api/v1/site", h.handleSite)
	mux.HandleFunc("GET /api/v1/agents", h.readAuth(h.handleAgents))
	mux.HandleFunc("GET /api/v1/agents/{id}", h.readAuth(h.handleAgent))
	mux.HandleFunc("GET /api/v1/agents/{id}/traffic", h.readAuth(h.handleTraffic))
	mux.HandleFunc("GET /api/v1/agents/{id}/metrics", h.readAuth(h.handleMetrics))
	mux.HandleFunc("GET /api/v1/targets", h.readAuth(h.handleTargets))
	mux.HandleFunc("GET /api/v1/ping", h.readAuth(h.handlePing))

	// auth
	mux.HandleFunc("POST /api/v1/auth/login", h.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", h.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/me", h.handleMe)
	mux.HandleFunc("GET /api/v1/auth/github", h.handleGitHubStart)
	mux.HandleFunc("GET /api/v1/auth/github/callback", h.handleGitHubCallback)

	// admin
	adm := func(pattern string, fn http.HandlerFunc) { mux.HandleFunc(pattern, h.requireAdmin(fn)) }
	adm("GET /api/v1/admin/agents", h.adminListAgents)
	adm("POST /api/v1/admin/agents", h.adminCreateAgent)
	adm("POST /api/v1/admin/agents/reorder", h.adminReorderAgents)
	adm("PUT /api/v1/admin/agents/{id}", h.adminUpdateAgent)
	adm("DELETE /api/v1/admin/agents/{id}", h.adminDeleteAgent)
	adm("POST /api/v1/admin/agents/{id}/rotate-token", h.adminRotateToken)
	adm("GET /api/v1/admin/agents/{id}/install", h.adminInstall)
	adm("GET /api/v1/admin/targets", h.adminListTargets)
	adm("POST /api/v1/admin/targets", h.adminCreateTarget)
	adm("POST /api/v1/admin/targets/reorder", h.adminReorderTargets)
	adm("PUT /api/v1/admin/targets/{id}", h.adminUpdateTarget)
	adm("DELETE /api/v1/admin/targets/{id}", h.adminDeleteTarget)
	adm("GET /api/v1/admin/channels", h.adminListChannels)
	adm("POST /api/v1/admin/channels", h.adminCreateChannel)
	adm("PUT /api/v1/admin/channels/{id}", h.adminUpdateChannel)
	adm("DELETE /api/v1/admin/channels/{id}", h.adminDeleteChannel)
	adm("POST /api/v1/admin/channels/{id}/test", h.adminTestChannel)
	adm("GET /api/v1/admin/settings", h.adminGetSettings)
	adm("PUT /api/v1/admin/settings", h.adminPutSettings)
	adm("POST /api/v1/admin/password", h.handleChangePassword)
	adm("GET /api/v1/admin/tokens", h.adminListTokens)
	adm("POST /api/v1/admin/tokens", h.adminCreateToken)
	adm("DELETE /api/v1/admin/tokens/{id}", h.adminDeleteToken)
	adm("GET /api/v1/admin/events", h.adminEvents)
	adm("GET /api/v1/admin/geoip", h.adminGeoip)
	adm("POST /api/v1/admin/geoip/update", h.adminGeoipUpdate)
	adm("GET /api/v1/admin/database", h.adminDatabase)
	adm("POST /api/v1/admin/vacuum", h.adminVacuum)
	adm("GET /api/v1/admin/themes", h.adminListThemes)
	adm("GET /api/v1/admin/themes/market", h.adminThemeMarket)
	adm("POST /api/v1/admin/themes/install", h.adminInstallTheme)
	adm("DELETE /api/v1/admin/themes/{name}", h.adminDeleteTheme)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "not_found", "no such endpoint")
	})

	mux.HandleFunc("GET /install.sh", h.handleInstallScript)
	mux.HandleFunc("GET /themes/{name}/{file...}", h.handleThemeFile)
	mux.Handle("/", h.spaHandler())
	return h.withHeaders(mux)
}

func (h *Hub) withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hd := w.Header()
		hd.Set("X-Content-Type-Options", "nosniff")
		hd.Set("Referrer-Policy", "same-origin")
		hd.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

// ---- agent endpoints ----

type ctxKey int

const agentKey ctxKey = iota

func (h *Hub) agentAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearer(r)
		if tok == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "missing agent token")
			return
		}
		a, err := h.db.AgentByToken(r.Context(), tok)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "unknown agent token")
			return
		}
		next(w, r.WithContext(withAgent(r.Context(), a)))
	}
}

func (h *Hub) handleReport(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r.Context())
	var rep proto.Report
	if err := decodeJSON(r, &rep); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if len(rep.Pings) > 5000 {
		writeErr(w, http.StatusBadRequest, "bad_request", "too many ping results in one report")
		return
	}
	now := time.Now()
	loc := h.location(rep.TZ, rep.TZOffset)
	h.st.ingest(a.ID, rep, now, loc)

	ip := clientIP(r, h.cfg.TrustProxy)
	facts := store.AgentFacts{IP: ip, TZ: rep.TZ, TZOffset: rep.TZOffset, Hostname: rep.Hostname, OS: rep.OS, Kernel: rep.Kernel,
		Arch: rep.Arch, CPUs: rep.CPUs, AgentVersion: rep.Version, LastSeen: now.Unix()}
	err := h.db.Tx(r.Context(), func(tx *sql.Tx) error {
		if err := h.db.UpdateAgentFacts(r.Context(), tx, a.ID, facts); err != nil {
			return err
		}
		return h.db.InsertPings(r.Context(), tx, a.ID, rep.Pings, now.Unix()+60)
	})
	if err != nil {
		h.log.Error("store report", "agent", a.ID, "err", err)
		writeErr(w, http.StatusInternalServerError, "internal", "could not store report")
		return
	}
	if needsCountry(a, ip) {
		go h.resolveCountry(a.ID, ip)
	}
	writeJSON(w, http.StatusOK, proto.ReportResponse{ConfigVersion: h.cfgVer.Load()})
}

func (h *Hub) handleAgentConfig(w http.ResponseWriter, r *http.Request) {
	a := agentFrom(r.Context())
	targets, err := h.db.TargetsForAgent(r.Context(), a.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	cfg := proto.Config{Version: h.cfgVer.Load(), Interval: a.Interval, Iface: a.Iface, Targets: []proto.Target{}}
	for _, t := range targets {
		cfg.Targets = append(cfg.Targets, proto.Target{ID: t.ID, Host: t.Host, Port: t.Port, Interval: t.Interval, Count: t.Count, TimeoutMS: t.TimeoutMS})
	}
	writeJSON(w, http.StatusOK, cfg)
}

// ---- read endpoints ----

func (h *Hub) handleSite(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":    h.setting("site_name"),
		"public":  h.setting("public") == "true",
		"theme":   h.setting("theme"),
		"github":  h.githubEnabled(),
		"version": h.version,
		"user":    h.currentUser(r),
	})
}

func (h *Hub) handleAgents(w http.ResponseWriter, r *http.Request) {
	views, err := h.agentViews(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !h.fullAccess(r) {
		visible := views[:0]
		for _, v := range views {
			if !v.Hidden {
				visible = append(visible, v)
			}
		}
		views = visible
	}
	writeJSON(w, http.StatusOK, views)
}

func (h *Hub) visibleAgent(w http.ResponseWriter, r *http.Request) (agentView, bool) {
	id := r.PathValue("id")
	views, err := h.agentViews(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return agentView{}, false
	}
	for _, v := range views {
		if v.ID == id && (!v.Hidden || h.fullAccess(r)) {
			return v, true
		}
	}
	writeErr(w, http.StatusNotFound, "not_found", "no such agent")
	return agentView{}, false
}

func (h *Hub) handleAgent(w http.ResponseWriter, r *http.Request) {
	if v, ok := h.visibleAgent(w, r); ok {
		writeJSON(w, http.StatusOK, v)
	}
}

var trafficPeriods = map[string]struct{ keyLen, limit int }{
	"day": {10, 31}, "month": {7, 24}, "year": {4, 10},
}

func (h *Hub) handleTraffic(w http.ResponseWriter, r *http.Request) {
	v, ok := h.visibleAgent(w, r)
	if !ok {
		return
	}
	period := r.URL.Query().Get("period")
	limit := int(queryInt(r, "limit", 0, 1, 1000))
	if period == "hour" {
		if limit == 0 {
			limit = 48
		}
		rows, err := h.db.TrafficHourly(r.Context(), v.ID, time.Now().Add(-time.Duration(limit)*time.Hour).Unix())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, rows)
		return
	}
	p, ok := trafficPeriods[period]
	if !ok {
		writeErr(w, http.StatusBadRequest, "bad_request", "period must be hour, day, month or year")
		return
	}
	if limit == 0 {
		limit = p.limit
	}
	rows, err := h.db.TrafficGrouped(r.Context(), v.ID, p.keyLen, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *Hub) handleMetrics(w http.ResponseWriter, r *http.Request) {
	v, ok := h.visibleAgent(w, r)
	if !ok {
		return
	}
	hours := queryInt(r, "hours", 24, 1, 168)
	now := time.Now().Unix()
	rows, err := h.db.Metrics(r.Context(), v.ID, now-hours*3600, now+60)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

type publicTarget struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Interval int      `json:"interval"`
	AgentIDs []string `json:"agent_ids"` // empty = every agent
}

func (h *Hub) handleTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := h.db.ListTargets(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	out := []publicTarget{}
	for _, t := range targets {
		if !t.Enabled {
			continue
		}
		pt := publicTarget{ID: t.ID, Name: t.Name, Interval: t.Interval, AgentIDs: []string{}}
		if !t.AllAgents {
			pt.AgentIDs = t.AgentIDs
		}
		out = append(out, pt)
	}
	writeJSON(w, http.StatusOK, out)
}

// handlePing picks the finest tier that both covers the range and keeps the
// point count sane, then returns every matching series.
func (h *Hub) handlePing(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	to := queryInt(r, "to", now.Unix(), 0, now.Unix()+3600)
	from := queryInt(r, "from", to-3*3600, 0, to)
	agentID, targetID := r.URL.Query().Get("agent"), r.URL.Query().Get("target")
	if agentID != "" && !h.fullAccess(r) {
		if a, err := h.db.GetAgent(r.Context(), agentID); err != nil || a.Hidden {
			writeErr(w, http.StatusNotFound, "not_found", "no such agent")
			return
		}
	}
	span := to - from
	tier, step := store.Tier1h, 3600
	switch {
	case span <= 36*3600 && from >= now.Add(-rawRetention).Unix():
		tier, step = store.TierRaw, 60
	case span <= 8*86400 && from >= now.Add(-m5Retention).Unix():
		tier, step = store.Tier5m, 300
	}
	series, err := h.db.QueryPings(r.Context(), tier, agentID, targetID, from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if !h.fullAccess(r) && agentID == "" {
		agents, _ := h.db.ListAgents(r.Context())
		hidden := map[string]bool{}
		for _, a := range agents {
			if a.Hidden {
				hidden[a.ID] = true
			}
		}
		kept := series[:0]
		for _, s := range series {
			if !hidden[s.AgentID] {
				kept = append(kept, s)
			}
		}
		series = kept
	}
	writeJSON(w, http.StatusOK, map[string]any{"tier": tier, "step": step, "from": from, "to": to, "series": series})
}

func storeErr(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, "internal", err.Error())
}

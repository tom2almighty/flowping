package hub

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

func withAgent(ctx context.Context, a store.Agent) context.Context {
	return context.WithValue(ctx, agentKey, a)
}

func agentFrom(ctx context.Context) store.Agent {
	a, _ := ctx.Value(agentKey).(store.Agent)
	return a
}

// ---- agents ----

type agentInput struct {
	Name      string        `json:"name"`
	Note      string        `json:"note"`
	Country   string        `json:"country"`
	Iface     string        `json:"iface"`
	Interval  int           `json:"interval"`
	SortOrder int           `json:"sort_order"`
	Hidden    bool          `json:"hidden"`
	Billing   store.Billing `json:"billing"`
}

var billingCycles = map[string]bool{"free": true, "lifetime": true, "monthly": true, "quarterly": true, "semiannual": true, "yearly": true, "custom": true}
var trafficModes = map[string]bool{"both": true, "rx": true, "tx": true, "max": true}

func (in *agentInput) validate() error {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return fmt.Errorf("name is required")
	}
	if in.Interval == 0 {
		in.Interval = 3
	}
	if in.Interval < 1 || in.Interval > 300 {
		return fmt.Errorf("interval must be 1-300 seconds")
	}
	in.Country = strings.ToLower(strings.TrimSpace(in.Country))
	if in.Country != "" && len(in.Country) != 2 {
		return fmt.Errorf("country must be a 2-letter code")
	}
	b := &in.Billing
	if b.Cycle == "" {
		b.Cycle = "free"
	}
	if !billingCycles[b.Cycle] {
		return fmt.Errorf("unknown billing cycle")
	}
	if b.Cycle == "custom" && b.Days < 1 {
		return fmt.Errorf("custom cycle needs a day count")
	}
	if b.Mode == "" {
		b.Mode = "both"
	}
	if !trafficModes[b.Mode] {
		return fmt.Errorf("unknown traffic mode")
	}
	if b.ResetDay < 1 || b.ResetDay > 31 {
		b.ResetDay = 1
	}
	if b.Currency == "" {
		b.Currency = "USD"
	}
	if b.ExpiresAt != "" {
		if _, err := time.Parse("2006-01-02", b.ExpiresAt); err != nil {
			return fmt.Errorf("expires_at must be YYYY-MM-DD")
		}
	}
	if b.Quota < 0 || b.Price < 0 {
		return fmt.Errorf("quota and price cannot be negative")
	}
	return nil
}

func (in agentInput) apply(a *store.Agent) {
	a.Name, a.Note, a.Country, a.Iface, a.Interval, a.SortOrder, a.Hidden, a.Billing =
		in.Name, in.Note, in.Country, strings.TrimSpace(in.Iface), in.Interval, in.SortOrder, in.Hidden, in.Billing
}

func (h *Hub) adminListAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := h.db.ListAgents(r.Context())
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, agents)
}

func (h *Hub) adminCreateAgent(w http.ResponseWriter, r *http.Request) {
	var in agentInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	now := time.Now().Unix()
	a := store.Agent{ID: newID(), Token: newToken("fpa_"), CreatedAt: now, UpdatedAt: now}
	in.apply(&a)
	if err := h.db.CreateAgent(r.Context(), a); err != nil {
		storeErr(w, err)
		return
	}
	h.bumpConfig()
	writeJSON(w, http.StatusCreated, a)
}

func (h *Hub) adminUpdateAgent(w http.ResponseWriter, r *http.Request) {
	a, err := h.db.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	var in agentInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	in.apply(&a)
	a.UpdatedAt = time.Now().Unix()
	if err := h.db.UpdateAgent(r.Context(), a); err != nil {
		storeErr(w, err)
		return
	}
	h.bumpConfig()
	writeJSON(w, http.StatusOK, a)
}

func (h *Hub) adminDeleteAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.db.DeleteAgent(r.Context(), id); err != nil {
		storeErr(w, err)
		return
	}
	h.st.forget(id)
	h.bumpConfig()
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) adminRotateToken(w http.ResponseWriter, r *http.Request) {
	a, err := h.db.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	a.Token = newToken("fpa_")
	if err := h.db.SetAgentToken(r.Context(), a.ID, a.Token); err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

func (h *Hub) adminInstall(w http.ResponseWriter, r *http.Request) {
	a, err := h.db.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	base := h.baseURL(r)
	image := h.cfg.AgentImage + ":latest"
	dir := "/opt/flowping-agent"
	compose := fmt.Sprintf(`mkdir -p %[1]s && cat > %[1]s/compose.yaml <<'EOF'
services:
  flowping-agent:
    image: %[2]s
    container_name: flowping-agent
    restart: unless-stopped
    network_mode: host
    pid: host
    volumes:
      - /:/host:ro
    environment:
      FLOWPING_HUB: %[3]s
      FLOWPING_TOKEN: %[4]s
    # 用 watchtower 自动更新 agent 时取消注释
    # labels:
    #   com.centurylinklabs.watchtower.enable: "true"
EOF
cd %[1]s && docker compose up -d`, dir, image, base, a.Token)
	writeJSON(w, http.StatusOK, map[string]string{
		"shell": fmt.Sprintf("curl -fsSL %s/install.sh | sh -s -- --hub %s --token %s", base, base, a.Token),
		"docker": fmt.Sprintf("docker run -d --name flowping-agent --restart unless-stopped --net host --pid host -v /:/host:ro -e FLOWPING_HUB=%s -e FLOWPING_TOKEN=%s %s",
			base, a.Token, image),
		"compose": compose,
	})
}

func (h *Hub) adminReorderAgents(w http.ResponseWriter, r *http.Request) {
	h.reorder(w, r, h.db.ReorderAgents)
}

func (h *Hub) adminReorderTargets(w http.ResponseWriter, r *http.Request) {
	h.reorder(w, r, h.db.ReorderTargets)
}

func (h *Hub) reorder(w http.ResponseWriter, r *http.Request, save func(context.Context, []string) error) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if len(in.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid", "ids is required")
		return
	}
	if err := save(r.Context(), in.IDs); err != nil {
		storeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- targets ----

type targetInput struct {
	Name      string   `json:"name"`
	Host      string   `json:"host"`
	Port      int      `json:"port"`
	Interval  int      `json:"interval"`
	Count     int      `json:"count"`
	TimeoutMS int      `json:"timeout_ms"`
	AllAgents *bool    `json:"all_agents"`
	AgentIDs  []string `json:"agent_ids"`
	Enabled   *bool    `json:"enabled"`
	SortOrder int      `json:"sort_order"`
}

func (in *targetInput) validate() error {
	in.Name, in.Host = strings.TrimSpace(in.Name), strings.TrimSpace(in.Host)
	if in.Host == "" {
		return fmt.Errorf("host is required")
	}
	if in.Name == "" {
		in.Name = in.Host
	}
	if in.Port < 1 || in.Port > 65535 {
		return fmt.Errorf("port must be 1-65535")
	}
	if in.Interval == 0 {
		in.Interval = 60
	}
	if in.Interval < 10 || in.Interval > 3600 {
		return fmt.Errorf("interval must be 10-3600 seconds")
	}
	if in.Count == 0 {
		in.Count = 20
	}
	if in.Count < 1 || in.Count > 100 {
		return fmt.Errorf("count must be 1-100")
	}
	if in.TimeoutMS == 0 {
		in.TimeoutMS = 2000
	}
	if in.TimeoutMS < 100 || in.TimeoutMS > 10000 {
		return fmt.Errorf("timeout must be 100-10000 ms")
	}
	if in.AgentIDs == nil {
		in.AgentIDs = []string{}
	}
	return nil
}

func (in targetInput) apply(t *store.Target) {
	t.Name, t.Host, t.Port, t.Interval, t.Count, t.TimeoutMS, t.SortOrder = in.Name, in.Host, in.Port, in.Interval, in.Count, in.TimeoutMS, in.SortOrder
	t.AgentIDs = in.AgentIDs
	if in.AllAgents != nil {
		t.AllAgents = *in.AllAgents
	}
	if in.Enabled != nil {
		t.Enabled = *in.Enabled
	}
}

func (h *Hub) adminListTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := h.db.ListTargets(r.Context())
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, targets)
}

func (h *Hub) adminCreateTarget(w http.ResponseWriter, r *http.Request) {
	var in targetInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	t := store.Target{ID: newID(), AllAgents: true, Enabled: true, CreatedAt: time.Now().Unix()}
	in.apply(&t)
	if err := h.db.SaveTarget(r.Context(), t, true); err != nil {
		storeErr(w, err)
		return
	}
	h.bumpConfig()
	writeJSON(w, http.StatusCreated, t)
}

func (h *Hub) adminUpdateTarget(w http.ResponseWriter, r *http.Request) {
	t, err := h.db.GetTarget(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	var in targetInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	in.apply(&t)
	if err := h.db.SaveTarget(r.Context(), t, false); err != nil {
		storeErr(w, err)
		return
	}
	h.bumpConfig()
	writeJSON(w, http.StatusOK, t)
}

func (h *Hub) adminDeleteTarget(w http.ResponseWriter, r *http.Request) {
	if err := h.db.DeleteTarget(r.Context(), r.PathValue("id")); err != nil {
		storeErr(w, err)
		return
	}
	h.bumpConfig()
	w.WriteHeader(http.StatusNoContent)
}

// ---- channels ----

type channelInput struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Enabled *bool  `json:"enabled"`
}

func (h *Hub) adminListChannels(w http.ResponseWriter, r *http.Request) {
	chs, err := h.db.ListChannels(r.Context())
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, chs)
}

func (h *Hub) adminCreateChannel(w http.ResponseWriter, r *http.Request) {
	var in channelInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	in.URL = strings.TrimSpace(in.URL)
	if in.URL == "" {
		writeErr(w, http.StatusBadRequest, "invalid", "url is required")
		return
	}
	if in.Name = strings.TrimSpace(in.Name); in.Name == "" {
		in.Name, _, _ = strings.Cut(in.URL, "://")
	}
	c := store.Channel{ID: newID(), Name: in.Name, URL: in.URL, Enabled: true, CreatedAt: time.Now().Unix()}
	if in.Enabled != nil {
		c.Enabled = *in.Enabled
	}
	if err := h.db.SaveChannel(r.Context(), c, true); err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Hub) adminUpdateChannel(w http.ResponseWriter, r *http.Request) {
	c, err := h.db.GetChannel(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	var in channelInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if in.URL = strings.TrimSpace(in.URL); in.URL != "" {
		c.URL = in.URL
	}
	if in.Name = strings.TrimSpace(in.Name); in.Name != "" {
		c.Name = in.Name
	}
	if in.Enabled != nil {
		c.Enabled = *in.Enabled
	}
	if err := h.db.SaveChannel(r.Context(), c, false); err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Hub) adminDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if err := h.db.DeleteChannel(r.Context(), r.PathValue("id")); err != nil {
		storeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) adminTestChannel(w http.ResponseWriter, r *http.Request) {
	c, err := h.db.GetChannel(r.Context(), r.PathValue("id"))
	if err != nil {
		storeErr(w, err)
		return
	}
	if err := sendNotification([]string{c.URL}, h.setting("site_name"), "✅ 来自 "+h.setting("site_name")+" 的测试通知"); err != nil {
		writeErr(w, http.StatusBadGateway, "send_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- settings ----

var editableSettings = map[string]func(string) error{
	"site_name":        nonEmpty,
	"public":           boolStr,
	"theme":            themeName,
	"theme_market_url": func(string) error { return nil },
	"github_users":     func(string) error { return nil },
	"notify_offline":   boolStr,
	"offline_grace":    intRange(15, 3600),
	"cpu_pct":          intRange(0, 100),
	"mem_pct":          intRange(0, 100),
	"disk_pct":         intRange(0, 100),
	"load_grace":       intRange(0, 86400),
	"loss_pct":         intRange(0, 100),
	"latency_ms":       intRange(0, 100000),
	"ping_grace":       intRange(0, 86400),
	"traffic_pct":      intRange(0, 100),
	"expire_days":      intRange(0, 365),
}

func nonEmpty(v string) error {
	if strings.TrimSpace(v) == "" {
		return fmt.Errorf("cannot be empty")
	}
	return nil
}

func themeName(v string) error {
	if v != "" && !themeNameRe.MatchString(v) {
		return fmt.Errorf("not a valid theme name")
	}
	return nil
}

func boolStr(v string) error {
	if v != "true" && v != "false" {
		return fmt.Errorf("must be true or false")
	}
	return nil
}

func intRange(lo, hi int) func(string) error {
	return func(v string) error {
		n, err := strconv.Atoi(v)
		if err != nil || n < lo || n > hi {
			return fmt.Errorf("must be a number between %d and %d", lo, hi)
		}
		return nil
	}
}

func (h *Hub) adminGetSettings(w http.ResponseWriter, r *http.Request) {
	out := map[string]string{}
	for k := range editableSettings {
		out[k] = h.setting(k)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Hub) adminPutSettings(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	for k, v := range in {
		check, ok := editableSettings[k]
		if !ok {
			writeErr(w, http.StatusBadRequest, "invalid", "unknown setting "+k)
			return
		}
		if err := check(v); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid", k+": "+err.Error())
			return
		}
	}
	for k, v := range in {
		if err := h.db.SetSetting(r.Context(), k, v); err != nil {
			storeErr(w, err)
			return
		}
	}
	_ = h.reloadSettings(r.Context())
	h.adminGetSettings(w, r)
}

// ---- api tokens ----

func (h *Hub) adminListTokens(w http.ResponseWriter, r *http.Request) {
	toks, err := h.db.ListAPITokens(r.Context())
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toks)
}

func (h *Hub) adminCreateToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if in.Name = strings.TrimSpace(in.Name); in.Name == "" {
		in.Name = "token"
	}
	tok := newToken("fpk_")
	t := store.APIToken{ID: newID(), Name: in.Name, CreatedAt: time.Now().Unix()}
	if err := h.db.CreateAPIToken(r.Context(), t, sha256Hex(tok)); err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": t.ID, "name": t.Name, "created_at": t.CreatedAt, "token": tok})
}

func (h *Hub) adminDeleteToken(w http.ResponseWriter, r *http.Request) {
	if err := h.db.DeleteAPIToken(r.Context(), r.PathValue("id")); err != nil {
		storeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) adminEvents(w http.ResponseWriter, r *http.Request) {
	events, err := h.db.ListEvents(r.Context(), int(queryInt(r, "limit", 100, 1, 1000)))
	if err != nil {
		storeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, events)
}

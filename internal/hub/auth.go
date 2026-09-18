package hub

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	sessionCookie = "fp_session"
	stateCookie   = "fp_oauth_state"
	sessionTTL    = 30 * 24 * time.Hour
)

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	key := argon2.IDKey([]byte(pw), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

func verifyPassword(encoded, pw string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[4])
	hash, err2 := base64.RawStdEncoding.DecodeString(parts[5])
	if err1 != nil || err2 != nil {
		return false
	}
	key := argon2.IDKey([]byte(pw), salt, t, m, p, uint32(len(hash)))
	return subtle.ConstantTimeCompare(key, hash) == 1
}

// limiter counts failed logins per IP inside a sliding window.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

func newLimiter(max int, window time.Duration) *limiter {
	return &limiter{max: max, window: window, hits: map[string][]time.Time{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cut := time.Now().Add(-l.window)
	h := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cut) {
			h = append(h, t)
		}
	}
	l.hits[key] = h
	return len(h) < l.max
}

func (l *limiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.hits[key] = append(l.hits[key], time.Now())
}

func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

func (h *Hub) currentUser(r *http.Request) string {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return ""
	}
	user, err := h.db.SessionUser(r.Context(), sha256Hex(c.Value))
	if err != nil {
		h.log.Error("session lookup", "err", err)
		return ""
	}
	return user
}

func (h *Hub) apiTokenOK(r *http.Request) bool {
	tok := bearer(r)
	if !strings.HasPrefix(tok, "fpk_") {
		return false
	}
	ok, err := h.db.TouchAPIToken(r.Context(), sha256Hex(tok))
	return err == nil && ok
}

func (h *Hub) startSession(w http.ResponseWriter, r *http.Request, user string) error {
	tok := newToken("")
	if err := h.db.CreateSession(r.Context(), sha256Hex(tok), user, sessionTTL); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: tok, Path: "/", HttpOnly: true,
		Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds()),
	})
	return nil
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// requireAdmin gates admin routes behind a session and blocks cross-site
// state changes, which together with JSON-only bodies covers CSRF.
func (h *Hub) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.currentUser(r) == "" {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "login required")
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeErr(w, http.StatusForbidden, "forbidden", "cross-site request blocked")
			return
		}
		next(w, r)
	}
}

// readAuth lets anyone read when the site is public; otherwise a session or
// an API token is required.
func (h *Hub) readAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.setting("public") == "true" || h.currentUser(r) != "" || h.apiTokenOK(r) {
			next(w, r)
			return
		}
		writeErr(w, http.StatusUnauthorized, "unauthorized", "login required")
	}
}

// fullAccess reports whether the caller may see hidden agents and admin-only fields.
func (h *Hub) fullAccess(r *http.Request) bool {
	return h.currentUser(r) != "" || h.apiTokenOK(r)
}

func (h *Hub) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, h.cfg.TrustProxy)
	if !h.login.allow(ip) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "too many failed logins, try again later")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if !verifyPassword(h.setting("admin_password_hash"), body.Password) {
		h.login.fail(ip)
		writeErr(w, http.StatusUnauthorized, "bad_password", "wrong password")
		return
	}
	h.login.reset(ip)
	if err := h.startSession(w, r, "admin"); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"user": "admin"})
}

func (h *Hub) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = h.db.DeleteSession(r.Context(), sha256Hex(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) handleMe(w http.ResponseWriter, r *http.Request) {
	user := h.currentUser(r)
	if user == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "login required")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"user": user})
}

func (h *Hub) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if len(body.New) < 8 {
		writeErr(w, http.StatusBadRequest, "weak_password", "use at least 8 characters")
		return
	}
	if !verifyPassword(h.setting("admin_password_hash"), body.Current) {
		writeErr(w, http.StatusUnauthorized, "bad_password", "current password is wrong")
		return
	}
	if err := h.db.SetSetting(r.Context(), "admin_password_hash", hashPassword(body.New)); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	_ = h.reloadSettings(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

// ---- GitHub OAuth ----

func (h *Hub) githubEnabled() bool {
	return h.cfg.GitHubClientID != "" && h.cfg.GitHubClientSecret != ""
}

func (h *Hub) handleGitHubStart(w http.ResponseWriter, r *http.Request) {
	if !h.githubEnabled() {
		writeErr(w, http.StatusNotFound, "not_configured", "GitHub login is not configured")
		return
	}
	state := newToken("")
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: state, Path: "/api/v1/auth/github", HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: 600})
	q := url.Values{
		"client_id":    {h.cfg.GitHubClientID},
		"redirect_uri": {h.baseURL(r) + "/api/v1/auth/github/callback"},
		"state":        {state},
	}
	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+q.Encode(), http.StatusFound)
}

func (h *Hub) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(reason string) {
		http.Redirect(w, r, "/login?error="+url.QueryEscape(reason), http.StatusFound)
	}
	c, err := r.Cookie(stateCookie)
	if err != nil || c.Value == "" || c.Value != r.URL.Query().Get("state") {
		fail("state mismatch")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/api/v1/auth/github", MaxAge: -1})
	code := r.URL.Query().Get("code")
	if code == "" {
		fail("GitHub returned no code")
		return
	}
	login, err := h.githubLogin(r.Context(), code, h.baseURL(r)+"/api/v1/auth/github/callback")
	if err != nil {
		h.log.Warn("github oauth failed", "err", err)
		fail("GitHub sign-in failed")
		return
	}
	if !h.githubAllowed(login) {
		h.log.Warn("github user not allowed", "login", login)
		fail("GitHub account " + login + " is not allowed")
		return
	}
	if err := h.startSession(w, r, "github:"+login); err != nil {
		fail("could not start session")
		return
	}
	http.Redirect(w, r, "/admin", http.StatusFound)
}

func (h *Hub) githubAllowed(login string) bool {
	for _, u := range strings.Split(h.setting("github_users"), ",") {
		if u = strings.TrimSpace(u); u != "" && strings.EqualFold(u, login) {
			return true
		}
	}
	return false
}

func (h *Hub) githubLogin(ctx context.Context, code, redirect string) (string, error) {
	form := url.Values{
		"client_id":     {h.cfg.GitHubClientID},
		"client_secret": {h.cfg.GitHubClientSecret},
		"code":          {code},
		"redirect_uri":  {redirect},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := doJSON(req, &tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("token exchange failed: %s", tok.Error)
	}
	req, _ = http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	var user struct {
		Login string `json:"login"`
	}
	if err := doJSON(req, &user); err != nil {
		return "", err
	}
	if user.Login == "" {
		return "", fmt.Errorf("no login in GitHub response")
	}
	return user.Login, nil
}

func doJSON(req *http.Request, v any) error {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s: %s", resp.Status, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

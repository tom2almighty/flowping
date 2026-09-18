package hub

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// A theme is a directory of static files: theme.json for metadata, theme.css
// that overrides the CSS variables, and any fonts or images it references.
// Scripts are never served from a theme, and the CSP blocks inline ones.

var themeNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

var themeFileExt = map[string]string{
	".css": "text/css; charset=utf-8", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff",
	".ttf": "font/ttf", ".otf": "font/otf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif", ".md": "text/plain; charset=utf-8",
}

type themeMeta struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	Version     string `json:"version"`
	Description string `json:"description"`
	Preview     string `json:"preview,omitempty"`
	URL         string `json:"url,omitempty"` // market only: zip download
}

func (h *Hub) themesDir() string { return filepath.Join(h.cfg.DataDir, "themes") }

func (h *Hub) installedThemes() ([]themeMeta, error) {
	entries, err := os.ReadDir(h.themesDir())
	if err != nil {
		return nil, err
	}
	out := []themeMeta{}
	for _, e := range entries {
		if !e.IsDir() || !themeNameRe.MatchString(e.Name()) {
			continue
		}
		m := themeMeta{Name: e.Name(), Title: e.Name()}
		if b, err := os.ReadFile(filepath.Join(h.themesDir(), e.Name(), "theme.json")); err == nil {
			_ = json.Unmarshal(b, &m)
			m.Name = e.Name()
		}
		if m.Title == "" {
			m.Title = m.Name
		}
		out = append(out, m)
	}
	return out, nil
}

func (h *Hub) adminListThemes(w http.ResponseWriter, r *http.Request) {
	themes, err := h.installedThemes()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, themes)
}

func (h *Hub) adminThemeMarket(w http.ResponseWriter, r *http.Request) {
	url := h.setting("theme_market_url")
	if url == "" {
		writeErr(w, http.StatusNotFound, "not_configured", "set a theme market URL in settings")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	var list []themeMeta
	if err := doJSON(req, &list); err != nil {
		writeErr(w, http.StatusBadGateway, "market_unreachable", err.Error())
		return
	}
	out := []themeMeta{}
	for _, m := range list {
		if themeNameRe.MatchString(m.Name) && m.URL != "" {
			out = append(out, m)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Hub) adminInstallTheme(w http.ResponseWriter, r *http.Request) {
	var in struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if !strings.HasPrefix(in.URL, "https://") && !strings.HasPrefix(in.URL, "http://") {
		writeErr(w, http.StatusBadRequest, "invalid", "url must be http(s)")
		return
	}
	m, err := h.installThemeZip(r.Context(), in.URL)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "install_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (h *Hub) installThemeZip(ctx context.Context, url string) (themeMeta, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return themeMeta{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return themeMeta{}, fmt.Errorf("download failed: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20+1))
	if err != nil {
		return themeMeta{}, err
	}
	if len(data) > 20<<20 {
		return themeMeta{}, fmt.Errorf("theme archive larger than 20 MB")
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return themeMeta{}, fmt.Errorf("not a zip archive")
	}

	// Accept files at the root or under one top-level directory.
	prefix := ""
	if len(zr.File) > 0 {
		first, _, hasDir := strings.Cut(zr.File[0].Name, "/")
		if hasDir {
			prefix = first + "/"
			for _, f := range zr.File {
				if !strings.HasPrefix(f.Name, prefix) {
					prefix = ""
					break
				}
			}
		}
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		name := strings.TrimPrefix(f.Name, prefix)
		if name == "" || strings.HasSuffix(name, "/") {
			continue
		}
		clean := path.Clean(name)
		if strings.HasPrefix(clean, "..") || path.IsAbs(clean) || strings.Contains(clean, "\\") {
			return themeMeta{}, fmt.Errorf("unsafe path in archive: %s", f.Name)
		}
		if _, ok := themeFileExt[strings.ToLower(path.Ext(clean))]; !ok {
			return themeMeta{}, fmt.Errorf("file type not allowed in themes: %s", clean)
		}
		if f.UncompressedSize64 > 5<<20 {
			return themeMeta{}, fmt.Errorf("file too large: %s", clean)
		}
		files[clean] = f
	}
	metaFile, ok := files["theme.json"]
	if !ok || files["theme.css"] == nil {
		return themeMeta{}, fmt.Errorf("theme needs theme.json and theme.css at its root")
	}
	var m themeMeta
	if err := readZipJSON(metaFile, &m); err != nil {
		return themeMeta{}, fmt.Errorf("theme.json: %w", err)
	}
	if !themeNameRe.MatchString(m.Name) {
		return themeMeta{}, fmt.Errorf("theme.json name must match %s", themeNameRe)
	}

	tmp, err := os.MkdirTemp(h.themesDir(), ".install-*")
	if err != nil {
		return themeMeta{}, err
	}
	defer os.RemoveAll(tmp)
	for name, f := range files {
		dst := filepath.Join(tmp, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return themeMeta{}, err
		}
		if err := extractZipFile(f, dst); err != nil {
			return themeMeta{}, err
		}
	}
	final := filepath.Join(h.themesDir(), m.Name)
	if err := os.RemoveAll(final); err != nil {
		return themeMeta{}, err
	}
	if err := os.Rename(tmp, final); err != nil {
		return themeMeta{}, err
	}
	if m.Title == "" {
		m.Title = m.Name
	}
	return m, nil
}

func readZipJSON(f *zip.File, v any) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	return json.NewDecoder(io.LimitReader(rc, 64<<10)).Decode(v)
}

func extractZipFile(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, io.LimitReader(rc, 5<<20))
	return err
}

func (h *Hub) adminDeleteTheme(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !themeNameRe.MatchString(name) {
		writeErr(w, http.StatusBadRequest, "invalid", "bad theme name")
		return
	}
	dir := filepath.Join(h.themesDir(), name)
	if _, err := os.Stat(dir); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "theme not installed")
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if h.setting("theme") == name {
		_ = h.db.SetSetting(r.Context(), "theme", "")
		_ = h.reloadSettings(r.Context())
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleThemeFile serves theme assets with a fixed content type per extension
// so nothing in a theme can ever execute.
func (h *Hub) handleThemeFile(w http.ResponseWriter, r *http.Request) {
	name, file := r.PathValue("name"), path.Clean("/"+r.PathValue("file"))
	ctype, ok := themeFileExt[strings.ToLower(path.Ext(file))]
	if !themeNameRe.MatchString(name) || !ok {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(h.themesDir(), name, filepath.FromSlash(file))
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

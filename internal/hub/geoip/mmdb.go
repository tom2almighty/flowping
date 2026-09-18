package geoip

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/oschwald/maxminddb-golang/v2"
)

// maxDBSize caps the download, since the file is fetched from a URL the
// operator chooses.
const maxDBSize = 64 << 20

// mmdb reads a country database from disk. The file is opened once and swapped
// atomically on update, so lookups never see a half-written database.
type mmdb struct {
	path string
	url  string
	log  *slog.Logger

	// updMu serialises downloads: switching the source back and forth must not
	// have two of them writing the same temporary file.
	updMu sync.Mutex

	mu sync.RWMutex
	r  *maxminddb.Reader
}

func newMMDB(path, url string, log *slog.Logger) *mmdb {
	m := &mmdb{path: path, url: url, log: log}
	if f, err := os.Stat(path); err == nil && f.Size() > 0 {
		if err := m.reload(); err != nil {
			log.Warn("geoip database unreadable", "path", path, "err", err)
		}
	}
	return m
}

func (m *mmdb) Name() string { return "mmdb" }

func (m *mmdb) loaded() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.r != nil
}

func (m *mmdb) Lookup(addr netip.Addr) (string, error) {
	m.mu.RLock()
	r := m.r
	m.mu.RUnlock()
	if r == nil {
		return "", errors.New("geoip database is not loaded")
	}
	var rec struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if err := r.Lookup(addr).Decode(&rec); err != nil {
		// An address the database does not carry decodes to nothing rather than
		// to a country, and that is not an error worth reporting upwards.
		return "", nil
	}
	return normalize(rec.Country.ISOCode), nil
}

// Update downloads the database, checks that it opens, and only then replaces
// the current file. A bad download therefore cannot break a working install.
func (m *mmdb) Update(ctx context.Context) error {
	if m.url == "" {
		return errors.New("no geoip download url configured")
	}
	m.updMu.Lock()
	defer m.updMu.Unlock()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "flowping-hub")
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDBSize+1))
	if err != nil {
		return err
	}
	if len(body) > maxDBSize {
		return fmt.Errorf("download larger than %d MB", maxDBSize>>20)
	}
	if data, err := gunzip(body); err != nil {
		return err
	} else if data != nil {
		body = data
	}

	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return err
	}
	tmp := m.path + ".download"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	reader, err := maxminddb.Open(tmp)
	if err != nil {
		os.Remove(tmp)
		return fmt.Errorf("downloaded file is not a usable database: %w", err)
	}
	if err := reader.Verify(); err != nil {
		reader.Close()
		os.Remove(tmp)
		return fmt.Errorf("downloaded database failed verification: %w", err)
	}
	reader.Close()
	if err := os.Rename(tmp, m.path); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := m.reload(); err != nil {
		return err
	}
	m.log.Info("geoip database updated", "bytes", len(body), "path", m.path)
	return nil
}

func (m *mmdb) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.r == nil {
		return nil
	}
	err := m.r.Close()
	m.r = nil
	return err
}

func (m *mmdb) reload() error {
	reader, err := maxminddb.Open(m.path)
	if err != nil {
		return err
	}
	m.mu.Lock()
	old := m.r
	m.r = reader
	m.mu.Unlock()
	if old != nil {
		return old.Close()
	}
	return nil
}

// gunzip transparently unpacks a gzipped database, which is how some mirrors
// (DB-IP among them) publish theirs. It returns nil for anything already raw.
func gunzip(b []byte) ([]byte, error) {
	if len(b) < 2 || b[0] != 0x1f || b[1] != 0x8b {
		return nil, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, maxDBSize))
	if err != nil {
		return nil, err
	}
	return out, nil
}

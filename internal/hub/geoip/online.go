package geoip

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// online asks free web services. Both are keyed by the IP the caller supplies,
// so the answer describes the agent rather than the hub. ipwho.is answers over
// HTTPS; ip-api.com's free tier is HTTP-only, so it is the fallback.
type online struct {
	client   *http.Client
	whoIsURL string // both templates take the address as %s
	ipAPIURL string
}

func newOnline() *online {
	return &online{
		client:   &http.Client{Timeout: 10 * time.Second},
		whoIsURL: "https://ipwho.is/%s?fields=success,country_code",
		ipAPIURL: "http://ip-api.com/json/%s?fields=status,message,countryCode",
	}
}

func (o *online) Name() string { return "online" }

func (o *online) Update(context.Context) error { return nil }
func (o *online) Close() error                 { return nil }

func (o *online) Lookup(addr netip.Addr) (string, error) {
	ip := addr.String()
	code, err := o.whoIs(ip)
	if code == "" {
		if code, err2 := o.ipAPI(ip); code != "" {
			return code, nil
		} else if err == nil {
			err = err2
		}
	}
	return code, err
}

func (o *online) whoIs(ip string) (string, error) {
	var out struct {
		Success     bool   `json:"success"`
		CountryCode string `json:"country_code"`
	}
	if err := o.get(fmt.Sprintf(o.whoIsURL, ip), &out); err != nil {
		return "", err
	}
	if !out.Success {
		return "", nil
	}
	return normalize(out.CountryCode), nil
}

func (o *online) ipAPI(ip string) (string, error) {
	var out struct {
		Status      string `json:"status"`
		Message     string `json:"message"`
		CountryCode string `json:"countryCode"`
	}
	if err := o.get(fmt.Sprintf(o.ipAPIURL, ip), &out); err != nil {
		return "", err
	}
	if out.Status != "success" {
		return "", nil
	}
	return normalize(out.CountryCode), nil
}

func (o *online) get(url string, v any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "flowping-hub")
	resp, err := o.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &httpError{url: url, status: resp.Status}
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

type httpError struct {
	url    string
	status string
}

func (e *httpError) Error() string { return e.url + ": " + e.status }

func normalize(code string) string {
	code = strings.TrimSpace(strings.ToLower(code))
	if len(code) != 2 {
		return ""
	}
	return code
}

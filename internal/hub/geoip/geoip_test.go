package geoip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestRoutable(t *testing.T) {
	cases := map[string]bool{
		"1.1.1.1":         true,
		"2606:4700::1111": true,
		"10.0.0.5":        false,
		"192.168.1.7":     false,
		"172.16.4.4":      false,
		"127.0.0.1":       false,
		"169.254.3.4":     false,
		"::1":             false,
		"fd00::1":         false,
	}
	for ip, want := range cases {
		if got := routable(netip.MustParseAddr(ip)); got != want {
			t.Errorf("routable(%s) = %v, want %v", ip, got, want)
		}
	}
}

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{"JP": "jp", " jp ": "jp", "JPN": "", "": ""} {
		if got := normalize(in); got != want {
			t.Errorf("normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOnlineLookupDecodes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"country_code":"DE"}`))
	}))
	defer srv.Close()

	o := newOnline()
	o.client = srv.Client()
	o.whoIsURL = srv.URL + "/%s"

	code, err := o.Lookup(netip.MustParseAddr("1.1.1.1"))
	if err != nil || code != "de" {
		t.Fatalf("Lookup = %q, %v; want de", code, err)
	}
}

// A failing first service falls through to the second.
func TestOnlineFallsBack(t *testing.T) {
	var second int
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusTooManyRequests)
	}))
	defer primary.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		second++
		_, _ = w.Write([]byte(`{"status":"success","countryCode":"SG"}`))
	}))
	defer fallback.Close()

	o := newOnline()
	o.client = primary.Client()
	o.whoIsURL = primary.URL + "/%s"
	o.ipAPIURL = fallback.URL + "/%s"

	code, err := o.Lookup(netip.MustParseAddr("1.1.1.1"))
	if err != nil || code != "sg" {
		t.Fatalf("Lookup = %q, %v; want sg", code, err)
	}
	if second != 1 {
		t.Fatalf("fallback calls = %d, want 1", second)
	}
}

type fakeProvider struct {
	calls int
	code  string
}

func (f *fakeProvider) Name() string                 { return "fake" }
func (f *fakeProvider) Update(context.Context) error { return nil }
func (f *fakeProvider) Close() error                 { return nil }
func (f *fakeProvider) Lookup(netip.Addr) (string, error) {
	f.calls++
	return f.code, nil
}

// The resolver answers from the cache, and never asks about addresses no
// country database can speak for.
func TestResolverCachesAndFilters(t *testing.T) {
	fake := &fakeProvider{code: "fr"}
	r := New(nil)
	r.Configure(Config{Source: SourceOnline})
	r.provider = fake

	if got := r.Lookup(t.Context(), "1.1.1.1"); got != "fr" {
		t.Fatalf("lookup = %q, want fr", got)
	}
	if got := r.Lookup(t.Context(), "1.1.1.1"); got != "fr" {
		t.Fatalf("cached lookup = %q, want fr", got)
	}
	if fake.calls != 1 {
		t.Fatalf("provider calls = %d, want 1 (second answer must come from the cache)", fake.calls)
	}

	for _, ip := range []string{"10.1.2.3", "127.0.0.1", "::1", "not-an-ip", ""} {
		if got := r.Lookup(t.Context(), ip); got != "" {
			t.Errorf("lookup(%q) = %q, want empty", ip, got)
		}
	}
	if fake.calls != 1 {
		t.Fatalf("private or invalid addresses reached the provider (%d calls)", fake.calls)
	}
}

func TestDisabledSource(t *testing.T) {
	r := New(nil)
	r.Configure(Config{Source: SourceOff})
	if got := r.Lookup(t.Context(), "1.1.1.1"); got != "" {
		t.Fatalf("lookup with the source off = %q, want empty", got)
	}
	if st := r.Status(); st.Ready || st.Source != SourceOff {
		t.Fatalf("status = %+v", st)
	}
}

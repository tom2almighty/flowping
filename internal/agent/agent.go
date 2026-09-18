package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/tom2almighty/flowping/internal/proto"
)

type Options struct {
	Hub     string
	Token   string
	Root    string
	Version string
	Log     *slog.Logger
}

type Agent struct {
	opt    Options
	log    *slog.Logger
	client *http.Client

	mu      sync.Mutex
	cfg     proto.Config
	pingers map[string]*pinger
	q       queue

	bootID string
	tzName string
	loc    *time.Location
	host   hostInfo

	prevCPU cpuSample
	prevNet struct {
		iface  string
		rx, tx uint64
		at     time.Time
	}
	ifaceName string
	ifaceAt   time.Time
	failing   bool
}

func New(opt Options) *Agent {
	a := &Agent{
		opt:     opt,
		log:     opt.Log,
		client:  &http.Client{Timeout: 15 * time.Second},
		pingers: map[string]*pinger{},
		cfg:     proto.Config{Interval: 3},
		bootID:  readTrim("/proc/sys/kernel/random/boot_id"),
		host:    readHostInfo(opt.Root),
	}
	a.tzName, a.loc = detectTZ(opt.Root)
	a.prevCPU, _ = readCPU()
	return a
}

// Run reports until ctx is cancelled. The first report response carries the
// hub's config version, which triggers the initial config fetch.
func (a *Agent) Run(ctx context.Context) {
	a.log.Info("agent started", "hub", a.opt.Hub, "version", a.opt.Version, "tz", a.tzName, "hostname", a.host.hostname)
	for {
		a.report(ctx)
		a.mu.Lock()
		iv := a.cfg.Interval
		a.mu.Unlock()
		select {
		case <-ctx.Done():
			a.shutdown()
			return
		case <-time.After(time.Duration(iv) * time.Second):
		}
	}
}

func (a *Agent) collect() proto.Report {
	now := time.Now()
	_, off := now.In(a.loc).Zone()
	r := proto.Report{
		Version:  a.opt.Version,
		BootID:   a.bootID,
		TZ:       a.tzName,
		TZOffset: off,
		Hostname: a.host.hostname,
		OS:       a.host.os,
		Kernel:   a.host.kernel,
		Arch:     runtime.GOARCH,
		CPUs:     a.host.cpus,
		Uptime:   readUptime(),
		Load:     readLoad(),
	}
	if cs, err := readCPU(); err == nil {
		r.CPU = math.Round(cpuPercent(a.prevCPU, cs)*10) / 10
		a.prevCPU = cs
	}
	m := readMem()
	r.MemTotal, r.MemUsed, r.SwapTotal, r.SwapUsed = m.total, m.used, m.swapTotal, m.swapUsed
	r.DiskTotal, r.DiskUsed = readDisk(a.opt.Root)

	if iface := a.currentIface(); iface != "" {
		if rx, tx, err := readNetCounters(iface); err == nil {
			r.Iface, r.RxBytes, r.TxBytes = iface, rx, tx
			p := &a.prevNet
			if p.iface == iface && !p.at.IsZero() {
				if dt := now.Sub(p.at).Seconds(); dt > 0 {
					if rx >= p.rx {
						r.RxRate = math.Round(float64(rx-p.rx) / dt)
					}
					if tx >= p.tx {
						r.TxRate = math.Round(float64(tx-p.tx) / dt)
					}
				}
			}
			p.iface, p.rx, p.tx, p.at = iface, rx, tx, now
		}
	}
	return r
}

func (a *Agent) currentIface() string {
	a.mu.Lock()
	forced := a.cfg.Iface
	a.mu.Unlock()
	if forced != "" {
		return forced
	}
	if a.ifaceName != "" && time.Since(a.ifaceAt) < time.Minute {
		return a.ifaceName
	}
	a.ifaceName, a.ifaceAt = detectIface(), time.Now()
	return a.ifaceName
}

func (a *Agent) report(ctx context.Context) {
	rep := a.collect()
	rep.Pings = a.q.take(2000)
	body, _ := json.Marshal(rep)
	resp, err := a.do(ctx, http.MethodPost, "/api/v1/agent/report", body)
	if err != nil {
		a.q.restore(rep.Pings)
		a.fail("report failed", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.q.restore(rep.Pings)
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		a.fail("report rejected", "status", resp.StatusCode, "body", string(b))
		return
	}
	if a.failing {
		a.log.Info("hub reachable again")
		a.failing = false
	}
	var rr proto.ReportResponse
	if err := json.NewDecoder(resp.Body).Decode(&rr); err != nil {
		a.log.Warn("bad report response", "err", err)
		return
	}
	a.mu.Lock()
	cur := a.cfg.Version
	a.mu.Unlock()
	if rr.ConfigVersion != cur {
		a.fetchConfig(ctx)
	}
}

// fail logs the first failure at warn and the rest at debug so a hub outage
// does not flood the journal.
func (a *Agent) fail(msg string, kv ...any) {
	if a.failing {
		a.log.Debug(msg, kv...)
		return
	}
	a.failing = true
	a.log.Warn(msg, kv...)
}

func (a *Agent) do(ctx context.Context, method, path string, body []byte) (*http.Response, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.opt.Hub+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.opt.Token)
	req.Header.Set("User-Agent", "flowping-agent/"+a.opt.Version)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return a.client.Do(req)
}

func (a *Agent) fetchConfig(ctx context.Context) {
	resp, err := a.do(ctx, http.MethodGet, "/api/v1/agent/config", nil)
	if err != nil {
		a.log.Warn("config fetch failed", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		a.log.Warn("config fetch rejected", "status", resp.StatusCode)
		return
	}
	var cfg proto.Config
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		a.log.Warn("bad config response", "err", err)
		return
	}
	a.apply(cfg)
}

func (a *Agent) apply(cfg proto.Config) {
	if cfg.Interval < 1 {
		cfg.Interval = 3
	}
	want := make(map[string]proto.Target, len(cfg.Targets))
	for _, t := range cfg.Targets {
		if t.Interval < 5 {
			t.Interval = 60
		}
		if t.Count < 1 || t.Count > 100 {
			t.Count = 20
		}
		if t.TimeoutMS < 100 {
			t.TimeoutMS = 2000
		}
		want[t.ID] = t
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.cfg = cfg
	a.ifaceName, a.ifaceAt = "", time.Time{}
	for id, p := range a.pingers {
		if t, ok := want[id]; !ok || t != p.t {
			p.close()
			delete(a.pingers, id)
		}
	}
	for id, t := range want {
		if _, ok := a.pingers[id]; !ok {
			p := newPinger(t, &a.q, a.log)
			a.pingers[id] = p
			go p.run()
		}
	}
	a.log.Info("config applied", "version", cfg.Version, "interval", cfg.Interval, "iface", cfg.Iface, "targets", len(want))
}

func (a *Agent) shutdown() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, p := range a.pingers {
		p.close()
		delete(a.pingers, id)
	}
}

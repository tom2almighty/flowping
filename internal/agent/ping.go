package agent

import (
	"context"
	"log/slog"
	"math"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/tom2almighty/flowping/internal/proto"
)

const maxQueued = 20000

// queue buffers ping results until the hub has accepted them.
type queue struct {
	mu    sync.Mutex
	items []proto.PingResult
}

func (q *queue) push(r proto.PingResult) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) >= maxQueued {
		q.items = append(q.items[:0], q.items[1:]...)
	}
	q.items = append(q.items, r)
}

func (q *queue) take(n int) []proto.PingResult {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return nil
	}
	if n > len(q.items) {
		n = len(q.items)
	}
	out := make([]proto.PingResult, n)
	copy(out, q.items[:n])
	q.items = append(q.items[:0], q.items[n:]...)
	return out
}

func (q *queue) restore(items []proto.PingResult) {
	if len(items) == 0 {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.items = append(items, q.items...)
	if len(q.items) > maxQueued {
		q.items = q.items[len(q.items)-maxQueued:]
	}
}

type pinger struct {
	t    proto.Target
	out  *queue
	log  *slog.Logger
	stop chan struct{}
	once sync.Once
}

func newPinger(t proto.Target, out *queue, log *slog.Logger) *pinger {
	return &pinger{t: t, out: out, log: log, stop: make(chan struct{})}
}

func (p *pinger) close() { p.once.Do(func() { close(p.stop) }) }

func (p *pinger) run() {
	ticker := time.NewTicker(time.Duration(p.t.Interval) * time.Second)
	defer ticker.Stop()
	p.cycle()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.cycle()
		}
	}
}

// cycle fires Count TCP connects spaced a few hundred ms apart without waiting
// for the previous one, so a fully timing-out target still finishes well
// within the interval.
func (p *pinger) cycle() {
	start := time.Now()
	addr := p.resolve()
	timeout := time.Duration(p.t.TimeoutMS) * time.Millisecond
	spacing := 200 * time.Millisecond
	if s := time.Duration(p.t.Interval) * time.Second / time.Duration(p.t.Count) / 2; s < spacing {
		spacing = s
	}
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		lat = make([]float64, 0, p.t.Count)
	)
	if addr != "" {
		for i := 0; i < p.t.Count; i++ {
			if i > 0 {
				select {
				case <-p.stop:
					return
				case <-time.After(spacing):
				}
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				if d := probe(addr, timeout); d >= 0 {
					mu.Lock()
					lat = append(lat, d)
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
	}
	r := summarize(lat)
	r.TargetID, r.TS, r.Sent = p.t.ID, start.Unix(), p.t.Count
	p.out.push(r)
}

func (p *pinger) resolve() string {
	port := strconv.Itoa(p.t.Port)
	if net.ParseIP(p.t.Host) != nil {
		return net.JoinHostPort(p.t.Host, port)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, p.t.Host)
	if err != nil || len(addrs) == 0 {
		p.log.Debug("resolve failed", "host", p.t.Host, "err", err)
		return ""
	}
	return net.JoinHostPort(addrs[0].IP.String(), port)
}

// probe returns the TCP connect time in milliseconds, or -1 on failure.
func probe(addr string, timeout time.Duration) float64 {
	t0 := time.Now()
	c, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return -1
	}
	d := time.Since(t0)
	_ = c.Close()
	return float64(d.Microseconds()) / 1000
}

func summarize(lat []float64) proto.PingResult {
	n := len(lat)
	r := proto.PingResult{Recv: n}
	if n == 0 {
		return r
	}
	sort.Float64s(lat)
	pct := func(p float64) float64 { return lat[int(math.Round(p*float64(n-1)))] }
	sum := 0.0
	for _, v := range lat {
		sum += v
	}
	r.Min, r.Max = round3(lat[0]), round3(lat[n-1])
	r.P25, r.P50, r.P75 = round3(pct(0.25)), round3(pct(0.5)), round3(pct(0.75))
	r.Avg = round3(sum / float64(n))
	return r
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

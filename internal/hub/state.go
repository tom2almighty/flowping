package hub

import (
	"sync"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
	"github.com/tom2almighty/flowping/internal/proto"
)

type liveAgent struct {
	report proto.Report
	at     time.Time
	pings  map[string]proto.PingResult // latest cycle per target
}

type bucketKey struct {
	hour int64
	day  string
}

type traffic struct{ rx, tx int64 }

type minuteAcc struct {
	ts               int64
	n                int
	cpu, mem, rx, tx float64
}

type doneMinute struct {
	agentID string
	row     store.MetricRow
}

// state is everything the hub keeps in memory between flushes: the latest
// report per agent, the counter baselines and the traffic deltas not yet
// written.
type state struct {
	mu       sync.Mutex
	live     map[string]*liveAgent
	counters map[string]store.Counter
	pending  map[string]map[bucketKey]*traffic
	minute   map[string]*minuteAcc
	done     []doneMinute
	lateTS   int64 // oldest ping ts accepted since the last aggregation, 0 = none
}

func newState(counters map[string]store.Counter) *state {
	return &state{
		live:     map[string]*liveAgent{},
		counters: counters,
		pending:  map[string]map[bucketKey]*traffic{},
		minute:   map[string]*minuteAcc{},
	}
}

// counterDelta handles plain growth, a 32-bit wrap and a counter reset.
func counterDelta(prev, cur uint64) uint64 {
	switch {
	case cur >= prev:
		return cur - prev
	case prev < 1<<32:
		return (1<<32 - prev) + cur
	default:
		return cur
	}
}

func (s *state) ingest(agentID string, r proto.Report, now time.Time, loc *time.Location) {
	s.mu.Lock()
	defer s.mu.Unlock()

	la := s.live[agentID]
	if la == nil {
		la = &liveAgent{pings: map[string]proto.PingResult{}}
		s.live[agentID] = la
	}
	la.report, la.at = r, now
	for _, p := range r.Pings {
		if cur, ok := la.pings[p.TargetID]; !ok || p.TS >= cur.TS {
			la.pings[p.TargetID] = p
		}
		if s.lateTS == 0 || p.TS < s.lateTS {
			s.lateTS = p.TS
		}
	}

	if r.Iface != "" {
		prev, ok := s.counters[agentID]
		var rx, tx uint64
		switch {
		case !ok || prev.At == 0 || prev.Iface != r.Iface:
			// no usable baseline: start counting from here
		case prev.BootID != r.BootID:
			// rebooted: counters restarted at zero, everything since boot is new
			rx, tx = r.RxBytes, r.TxBytes
		default:
			rx, tx = counterDelta(prev.Rx, r.RxBytes), counterDelta(prev.Tx, r.TxBytes)
		}
		s.counters[agentID] = store.Counter{BootID: r.BootID, Iface: r.Iface, Rx: r.RxBytes, Tx: r.TxBytes, At: now.Unix()}
		if rx > 0 || tx > 0 {
			local := now.In(loc)
			key := bucketKey{
				hour: time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), 0, 0, 0, loc).Unix(),
				day:  local.Format("2006-01-02"),
			}
			buckets := s.pending[agentID]
			if buckets == nil {
				buckets = map[bucketKey]*traffic{}
				s.pending[agentID] = buckets
			}
			b := buckets[key]
			if b == nil {
				b = &traffic{}
				buckets[key] = b
			}
			b.rx += int64(rx)
			b.tx += int64(tx)
		}
	}

	m := now.Unix() / 60 * 60
	acc := s.minute[agentID]
	if acc == nil || acc.ts != m {
		if acc != nil && acc.n > 0 {
			n := float64(acc.n)
			s.done = append(s.done, doneMinute{agentID, store.MetricRow{TS: acc.ts, CPU: acc.cpu / n, Mem: acc.mem / n, RxRate: acc.rx / n, TxRate: acc.tx / n}})
		}
		acc = &minuteAcc{ts: m}
		s.minute[agentID] = acc
	}
	acc.n++
	acc.cpu += r.CPU
	if r.MemTotal > 0 {
		acc.mem += 100 * float64(r.MemUsed) / float64(r.MemTotal)
	}
	acc.rx += r.RxRate
	acc.tx += r.TxRate
}

func (s *state) get(agentID string) (liveAgent, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	la := s.live[agentID]
	if la == nil {
		return liveAgent{}, false
	}
	cp := *la
	cp.pings = make(map[string]proto.PingResult, len(la.pings))
	for k, v := range la.pings {
		cp.pings[k] = v
	}
	return cp, true
}

func (s *state) forget(agentID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.live, agentID)
	delete(s.counters, agentID)
	delete(s.pending, agentID)
	delete(s.minute, agentID)
}

type flushBatch struct {
	traffic  map[string]map[bucketKey]*traffic
	counters map[string]store.Counter
	minutes  []doneMinute
}

func (s *state) takeBatch() flushBatch {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := flushBatch{traffic: s.pending, counters: make(map[string]store.Counter, len(s.counters)), minutes: s.done}
	for k, v := range s.counters {
		b.counters[k] = v
	}
	s.pending = map[string]map[bucketKey]*traffic{}
	s.done = nil
	return b
}

// restore merges a batch back after a failed flush.
func (s *state) restore(b flushBatch) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, buckets := range b.traffic {
		dst := s.pending[id]
		if dst == nil {
			s.pending[id] = buckets
			continue
		}
		for k, v := range buckets {
			if d := dst[k]; d != nil {
				d.rx += v.rx
				d.tx += v.tx
			} else {
				dst[k] = v
			}
		}
	}
	s.done = append(b.minutes, s.done...)
}

func (s *state) takeLateTS() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.lateTS
	s.lateTS = 0
	return v
}

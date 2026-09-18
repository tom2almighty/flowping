package hub

import (
	"context"
	"sort"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

type trafficSum struct {
	Rx int64 `json:"rx"`
	Tx int64 `json:"tx"`
}

type periodUsage struct {
	Start int64   `json:"start"`
	End   int64   `json:"end"`
	Rx    int64   `json:"rx"`
	Tx    int64   `json:"tx"`
	Used  int64   `json:"used"`  // bytes counted against the quota, per traffic mode
	Quota int64   `json:"quota"` // 0 = unlimited
	Pct   float64 `json:"pct"`   // 0 when unlimited
}

type pingView struct {
	TargetID string   `json:"target_id"`
	TS       int64    `json:"ts"`
	Loss     float64  `json:"loss"` // percent
	P50      *float64 `json:"p50"`
}

// agentView is the read model behind the dashboard, the detail page and the
// alert engine. Public callers never see tokens; hidden agents are filtered
// by the caller.
type agentView struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Note         string        `json:"note"`
	Country      string        `json:"country"`
	Hidden       bool          `json:"hidden"`
	TZ           string        `json:"tz"`
	Online       bool          `json:"online"`
	Pending      bool          `json:"pending"` // never reported yet
	LastSeen     int64         `json:"last_seen"`
	Hostname     string        `json:"hostname"`
	OS           string        `json:"os"`
	Kernel       string        `json:"kernel"`
	Arch         string        `json:"arch"`
	CPUs         int           `json:"cpus"`
	AgentVersion string        `json:"agent_version"`
	Uptime       int64         `json:"uptime"`
	CPU          float64       `json:"cpu"`
	Load         [3]float64    `json:"load"`
	MemTotal     uint64        `json:"mem_total"`
	MemUsed      uint64        `json:"mem_used"`
	SwapTotal    uint64        `json:"swap_total"`
	SwapUsed     uint64        `json:"swap_used"`
	DiskTotal    uint64        `json:"disk_total"`
	DiskUsed     uint64        `json:"disk_used"`
	Iface        string        `json:"iface"`
	RxRate       float64       `json:"rx_rate"`
	TxRate       float64       `json:"tx_rate"`
	Today        trafficSum    `json:"today"`
	Month        trafficSum    `json:"month"`
	Year         trafficSum    `json:"year"`
	Total        trafficSum    `json:"total"`
	Period       periodUsage   `json:"period"`
	Billing      store.Billing `json:"billing"`
	DaysLeft     *int          `json:"days_left"`
	Pings        []pingView    `json:"pings"`
}

func (v agentView) memPct() float64 {
	if v.MemTotal == 0 {
		return 0
	}
	return 100 * float64(v.MemUsed) / float64(v.MemTotal)
}

func (v agentView) diskPct() float64 {
	if v.DiskTotal == 0 {
		return 0
	}
	return 100 * float64(v.DiskUsed) / float64(v.DiskTotal)
}

func (h *Hub) agentViews(ctx context.Context) ([]agentView, error) {
	agents, err := h.db.ListAgents(ctx)
	if err != nil {
		return nil, err
	}
	totals, err := h.db.TrafficTotals(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	grace := time.Duration(h.settingInt("offline_grace")) * time.Second
	if grace < 15*time.Second {
		grace = 15 * time.Second
	}

	type span struct {
		loc         *time.Location
		local       time.Time
		periodStart time.Time
		periodEnd   time.Time
	}
	spans := make([]span, len(agents))
	fromDay := ""
	for i, a := range agents {
		loc := h.location(a.TZ, a.TZOffset)
		ps, pe := trafficPeriod(now, a.Billing.ResetDay, loc)
		spans[i] = span{loc: loc, local: now.In(loc), periodStart: ps, periodEnd: pe}
		yearStart := time.Date(spans[i].local.Year(), 1, 1, 0, 0, 0, 0, loc)
		for _, d := range []string{ps.Format("2006-01-02"), yearStart.Format("2006-01-02")} {
			if fromDay == "" || d < fromDay {
				fromDay = d
			}
		}
	}
	var rows []store.AgentTraffic
	if fromDay != "" {
		if rows, err = h.db.TrafficDailySince(ctx, fromDay); err != nil {
			return nil, err
		}
	}
	byAgent := map[string][]store.AgentTraffic{}
	for _, r := range rows {
		byAgent[r.AgentID] = append(byAgent[r.AgentID], r)
	}

	out := make([]agentView, 0, len(agents))
	for i, a := range agents {
		sp := spans[i]
		v := agentView{
			ID: a.ID, Name: a.Name, Note: a.Note, Country: a.Country, Hidden: a.Hidden, TZ: a.TZ,
			LastSeen: a.LastSeen, Hostname: a.Hostname, OS: a.OS, Kernel: a.Kernel, Arch: a.Arch, CPUs: a.CPUs,
			AgentVersion: a.AgentVersion, Billing: a.Billing, Pings: []pingView{},
		}
		if la, ok := h.st.get(a.ID); ok {
			r := la.report
			v.LastSeen = la.at.Unix()
			v.Online = now.Sub(la.at) <= grace
			v.Uptime, v.CPU, v.Load = r.Uptime, r.CPU, r.Load
			v.MemTotal, v.MemUsed, v.SwapTotal, v.SwapUsed = r.MemTotal, r.MemUsed, r.SwapTotal, r.SwapUsed
			v.DiskTotal, v.DiskUsed = r.DiskTotal, r.DiskUsed
			v.Iface, v.RxRate, v.TxRate = r.Iface, r.RxRate, r.TxRate
			for tid, p := range la.pings {
				pv := pingView{TargetID: tid, TS: p.TS, P50: nil}
				if p.Sent > 0 {
					pv.Loss = 100 * float64(p.Sent-p.Recv) / float64(p.Sent)
				}
				if p.Recv > 0 {
					p50 := p.P50
					pv.P50 = &p50
				}
				v.Pings = append(v.Pings, pv)
			}
			sort.Slice(v.Pings, func(i, j int) bool { return v.Pings[i].TargetID < v.Pings[j].TargetID })
		}
		v.Pending = v.LastSeen == 0
		if t, ok := totals[a.ID]; ok {
			v.Total = trafficSum{t[0], t[1]}
		}
		today := sp.local.Format("2006-01-02")
		month := sp.local.Format("2006-01")
		year := sp.local.Format("2006")
		ps, pe := sp.periodStart.Format("2006-01-02"), sp.periodEnd.Format("2006-01-02")
		for _, r := range byAgent[a.ID] {
			if r.Day == today {
				v.Today.Rx += r.Rx
				v.Today.Tx += r.Tx
			}
			if r.Day[:7] == month {
				v.Month.Rx += r.Rx
				v.Month.Tx += r.Tx
			}
			if r.Day[:4] == year {
				v.Year.Rx += r.Rx
				v.Year.Tx += r.Tx
			}
			if r.Day >= ps && r.Day < pe {
				v.Period.Rx += r.Rx
				v.Period.Tx += r.Tx
			}
		}
		v.Period.Start, v.Period.End = sp.periodStart.Unix(), sp.periodEnd.Unix()
		v.Period.Used = countedTraffic(a.Billing.Mode, v.Period.Rx, v.Period.Tx)
		v.Period.Quota = a.Billing.Quota
		if a.Billing.Quota > 0 {
			v.Period.Pct = 100 * float64(v.Period.Used) / float64(a.Billing.Quota)
		}
		if d, ok := daysLeft(a.Billing, now, sp.loc); ok {
			v.DaysLeft = &d
		}
		out = append(out, v)
	}
	return out, nil
}

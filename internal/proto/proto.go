// Package proto holds the wire types shared by hub and agent.
package proto

// Report is what an agent POSTs to the hub every interval.
type Report struct {
	Version  string `json:"version"`
	BootID   string `json:"boot_id"`
	TZ       string `json:"tz"`        // IANA zone name, may be empty
	TZOffset int    `json:"tz_offset"` // seconds east of UTC, used when TZ is empty or unknown

	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Kernel   string `json:"kernel"`
	Arch     string `json:"arch"`
	CPUs     int    `json:"cpus"`
	Uptime   int64  `json:"uptime"` // seconds

	CPU  float64    `json:"cpu"` // percent 0-100 over the last interval
	Load [3]float64 `json:"load"`

	MemTotal  uint64 `json:"mem_total"`
	MemUsed   uint64 `json:"mem_used"`
	SwapTotal uint64 `json:"swap_total"`
	SwapUsed  uint64 `json:"swap_used"`
	DiskTotal uint64 `json:"disk_total"`
	DiskUsed  uint64 `json:"disk_used"`

	Iface   string  `json:"iface"`
	RxBytes uint64  `json:"rx_bytes"` // cumulative kernel counter
	TxBytes uint64  `json:"tx_bytes"`
	RxRate  float64 `json:"rx_rate"` // bytes/s over the last interval
	TxRate  float64 `json:"tx_rate"`

	Pings []PingResult `json:"pings,omitempty"`
}

// PingResult is one probe cycle (N TCP connects) against one target.
// Latencies are milliseconds; they are zero when Recv is zero.
type PingResult struct {
	TargetID string  `json:"target_id"`
	TS       int64   `json:"ts"` // unix seconds, cycle start
	Sent     int     `json:"sent"`
	Recv     int     `json:"recv"`
	Min      float64 `json:"min"`
	P25      float64 `json:"p25"`
	P50      float64 `json:"p50"`
	P75      float64 `json:"p75"`
	Max      float64 `json:"max"`
	Avg      float64 `json:"avg"`
}

// ReportResponse tells the agent whether its config changed.
type ReportResponse struct {
	ConfigVersion int64 `json:"config_version"`
}

// Config is pulled by the agent when the version changes.
type Config struct {
	Version  int64    `json:"version"`
	Interval int      `json:"interval"` // report interval, seconds
	Iface    string   `json:"iface"`    // empty = auto-detect default-route interface
	Targets  []Target `json:"targets"`
}

// Target is a TCP ping destination.
type Target struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Interval  int    `json:"interval"`   // seconds between cycles
	Count     int    `json:"count"`      // probes per cycle
	TimeoutMS int    `json:"timeout_ms"` // per-probe connect timeout
}

// Error is the uniform API error body.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

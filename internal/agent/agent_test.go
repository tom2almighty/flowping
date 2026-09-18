package agent

import "testing"

func TestSummarize(t *testing.T) {
	r := summarize(nil)
	if r.Recv != 0 || r.P50 != 0 {
		t.Fatalf("empty: %+v", r)
	}
	r = summarize([]float64{30, 10, 50, 20, 40})
	if r.Recv != 5 || r.Min != 10 || r.Max != 50 || r.P50 != 30 || r.P25 != 20 || r.P75 != 40 || r.Avg != 30 {
		t.Fatalf("got %+v", r)
	}
}

func TestIfaceExcluded(t *testing.T) {
	for _, n := range []string{"lo", "docker0", "veth1a2b", "br-abc", "tun0"} {
		if !ifaceExcluded(n) {
			t.Errorf("%s should be excluded", n)
		}
	}
	for _, n := range []string{"eth0", "ens3", "enp0s3", "wlan0", "bond0"} {
		if ifaceExcluded(n) {
			t.Errorf("%s should be allowed", n)
		}
	}
}

func TestCPUPercent(t *testing.T) {
	if p := cpuPercent(cpuSample{busy: 100, total: 200}, cpuSample{busy: 150, total: 300}); p != 50 {
		t.Errorf("got %v want 50", p)
	}
	if p := cpuPercent(cpuSample{busy: 100, total: 200}, cpuSample{busy: 100, total: 200}); p != 0 {
		t.Errorf("no change: got %v", p)
	}
}

package agent

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var excludedIfacePrefixes = []string{"docker", "veth", "br-", "tun"}

func ifaceExcluded(name string) bool {
	if name == "lo" {
		return true
	}
	for _, p := range excludedIfacePrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// detectIface picks the interface carrying the default route (IPv4, then
// IPv6), falling back to the first non-excluded interface that is up.
func detectIface() string {
	if n := defaultRoute4(); n != "" {
		return n
	}
	if n := defaultRoute6(); n != "" {
		return n
	}
	return firstUpIface()
}

func defaultRoute4() string {
	b, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return ""
	}
	best, bestMetric := "", int64(0)
	for _, line := range strings.Split(string(b), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) < 7 || f[1] != "00000000" || ifaceExcluded(f[0]) {
			continue
		}
		flags, _ := strconv.ParseInt(f[3], 16, 64)
		if flags&1 == 0 { // RTF_UP
			continue
		}
		metric, _ := strconv.ParseInt(f[6], 10, 64)
		if best == "" || metric < bestMetric {
			best, bestMetric = f[0], metric
		}
	}
	return best
}

func defaultRoute6() string {
	b, err := os.ReadFile("/proc/net/ipv6_route")
	if err != nil {
		return ""
	}
	zero := strings.Repeat("0", 32)
	best, bestMetric := "", int64(0)
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) < 10 || f[0] != zero || f[1] != "00" || ifaceExcluded(f[9]) {
			continue
		}
		flags, _ := strconv.ParseInt(f[8], 16, 64)
		if flags&1 == 0 {
			continue
		}
		metric, _ := strconv.ParseInt(f[5], 16, 64)
		if best == "" || metric < bestMetric {
			best, bestMetric = f[9], metric
		}
	}
	return best
}

func firstUpIface() string {
	entries, err := os.ReadDir("/sys/class/net")
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if ifaceExcluded(e.Name()) {
			continue
		}
		if readTrim(filepath.Join("/sys/class/net", e.Name(), "operstate")) == "up" {
			return e.Name()
		}
	}
	return ""
}

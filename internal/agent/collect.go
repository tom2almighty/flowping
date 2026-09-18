package agent

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type cpuSample struct{ busy, total uint64 }

func readCPU() (cpuSample, error) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuSample{}, err
	}
	line, _, _ := strings.Cut(string(b), "\n")
	f := strings.Fields(line)
	if len(f) < 5 || f[0] != "cpu" {
		return cpuSample{}, errors.New("unexpected /proc/stat format")
	}
	var vals [8]uint64 // user nice system idle iowait irq softirq steal
	for i := range vals {
		if i+1 < len(f) {
			vals[i], _ = strconv.ParseUint(f[i+1], 10, 64)
		}
	}
	var total uint64
	for _, v := range vals {
		total += v
	}
	idle := vals[3] + vals[4]
	return cpuSample{busy: total - idle, total: total}, nil
}

func cpuPercent(prev, cur cpuSample) float64 {
	if cur.total <= prev.total || cur.busy < prev.busy {
		return 0
	}
	return 100 * float64(cur.busy-prev.busy) / float64(cur.total-prev.total)
}

func countCPUs() int {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return runtime.NumCPU()
	}
	n := 0
	for _, line := range strings.Split(string(b), "\n") {
		if len(line) > 3 && line[:3] == "cpu" && line[3] >= '0' && line[3] <= '9' {
			n++
		}
	}
	if n == 0 {
		return runtime.NumCPU()
	}
	return n
}

type memInfo struct{ total, used, swapTotal, swapUsed uint64 }

func readMem() memInfo {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return memInfo{}
	}
	kv := map[string]uint64{}
	for _, line := range strings.Split(string(b), "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		f := strings.Fields(v)
		if len(f) == 0 {
			continue
		}
		n, _ := strconv.ParseUint(f[0], 10, 64)
		kv[k] = n * 1024
	}
	m := memInfo{total: kv["MemTotal"], swapTotal: kv["SwapTotal"]}
	if avail, ok := kv["MemAvailable"]; ok {
		m.used = sub(m.total, avail)
	} else {
		m.used = sub(m.total, kv["MemFree"]+kv["Buffers"]+kv["Cached"])
	}
	m.swapUsed = sub(m.swapTotal, kv["SwapFree"])
	return m
}

func sub(a, b uint64) uint64 {
	if b > a {
		return 0
	}
	return a - b
}

func readDisk(path string) (total, used uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	bs := uint64(st.Frsize)
	if bs == 0 {
		bs = uint64(st.Bsize)
	}
	return st.Blocks * bs, (st.Blocks - st.Bfree) * bs
}

func readLoad() [3]float64 {
	var l [3]float64
	f := strings.Fields(readTrim("/proc/loadavg"))
	for i := 0; i < 3 && i < len(f); i++ {
		l[i], _ = strconv.ParseFloat(f[i], 64)
	}
	return l
}

func readUptime() int64 {
	f := strings.Fields(readTrim("/proc/uptime"))
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(f[0], 64)
	return int64(v)
}

func readNetCounters(iface string) (rx, tx uint64, err error) {
	base := filepath.Join("/sys/class/net", iface, "statistics")
	if rx, err = readUint(filepath.Join(base, "rx_bytes")); err != nil {
		return 0, 0, err
	}
	if tx, err = readUint(filepath.Join(base, "tx_bytes")); err != nil {
		return 0, 0, err
	}
	return rx, tx, nil
}

func readUint(path string) (uint64, error) {
	return strconv.ParseUint(readTrim(path), 10, 64)
}

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

type hostInfo struct {
	hostname string
	os       string
	kernel   string
	cpus     int
}

func readHostInfo(root string) hostInfo {
	h := hostInfo{kernel: readTrim("/proc/sys/kernel/osrelease"), cpus: countCPUs()}
	if root == "/" {
		h.hostname, _ = os.Hostname()
	} else {
		h.hostname = readTrim(filepath.Join(root, "etc/hostname"))
	}
	for _, p := range []string{"etc/os-release", "usr/lib/os-release"} {
		if h.os = osPrettyName(filepath.Join(root, p)); h.os != "" {
			break
		}
	}
	return h
}

func osPrettyName(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			return strings.Trim(strings.TrimSpace(v), `"`)
		}
	}
	return ""
}

// detectTZ returns the IANA zone name (may be empty) and a location parsed
// from root/etc/localtime, so the offset is right even inside a container
// whose own clock is UTC.
func detectTZ(root string) (string, *time.Location) {
	name := ""
	if root == "/" {
		name = os.Getenv("TZ")
	}
	localtime := filepath.Join(root, "etc/localtime")
	tzfile := localtime
	if link, err := os.Readlink(localtime); err == nil {
		if i := strings.Index(link, "zoneinfo/"); name == "" && i >= 0 {
			name = link[i+len("zoneinfo/"):]
		}
		// resolve the link inside root, since an absolute target points at the host tree
		if filepath.IsAbs(link) {
			tzfile = filepath.Join(root, link)
		} else {
			tzfile = filepath.Join(root, "etc", link)
		}
	}
	if name == "" {
		name = readTrim(filepath.Join(root, "etc/timezone"))
	}
	loc := time.Local
	for _, p := range []string{tzfile, localtime} {
		if b, err := os.ReadFile(p); err == nil {
			if l, err := time.LoadLocationFromTZData(name, b); err == nil {
				loc = l
				break
			}
		}
	}
	return name, loc
}

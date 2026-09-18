package hub

import (
	"testing"
	"time"
)

func TestCounterDelta(t *testing.T) {
	cases := []struct {
		name      string
		prev, cur uint64
		want      uint64
	}{
		{"growth", 100, 250, 150},
		{"unchanged", 100, 100, 0},
		{"wrap32", 1<<32 - 10, 5, 15},
		{"reset64", 1 << 40, 7, 7},
	}
	for _, c := range cases {
		if got := counterDelta(c.prev, c.cur); got != c.want {
			t.Errorf("%s: counterDelta(%d,%d)=%d want %d", c.name, c.prev, c.cur, got, c.want)
		}
	}
}

func TestTrafficPeriod(t *testing.T) {
	loc := time.FixedZone("x", 8*3600)
	// reset on the 31st in a 30-day month clamps to the 30th
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, loc)
	start, end := trafficPeriod(now, 31, loc)
	if start.Format("2006-01-02") != "2026-08-31" || end.Format("2006-01-02") != "2026-09-30" {
		t.Errorf("reset 31: got %s .. %s", start.Format("2006-01-02"), end.Format("2006-01-02"))
	}
	// before the reset day the period started last month
	start, end = trafficPeriod(now, 25, loc)
	if start.Format("2006-01-02") != "2026-08-25" || end.Format("2006-01-02") != "2026-09-25" {
		t.Errorf("reset 25: got %s .. %s", start.Format("2006-01-02"), end.Format("2006-01-02"))
	}
	// on the reset day the period starts today
	start, _ = trafficPeriod(now, 18, loc)
	if start.Format("2006-01-02") != "2026-09-18" {
		t.Errorf("reset 18: got %s", start.Format("2006-01-02"))
	}
	// day boundaries follow the agent zone, not UTC
	late := time.Date(2026, 9, 17, 20, 0, 0, 0, time.UTC) // 04:00 on the 18th in +8
	start, _ = trafficPeriod(late, 18, loc)
	if start.Format("2006-01-02") != "2026-09-18" {
		t.Errorf("tz boundary: got %s", start.Format("2006-01-02"))
	}
}

func TestRenewedExpiry(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 9, 18, 0, 0, 0, 0, loc)
	b := billingWith("monthly", 0, "2026-06-10")
	got, changed := renewedExpiry(b, now, loc)
	if !changed || got != "2026-10-10" {
		t.Errorf("monthly: got %s changed=%v", got, changed)
	}
	b = billingWith("custom", 45, "2026-09-01")
	if got, changed := renewedExpiry(b, now, loc); !changed || got != "2026-10-16" {
		t.Errorf("custom: got %s changed=%v", got, changed)
	}
	b = billingWith("yearly", 0, "2027-01-01")
	if _, changed := renewedExpiry(b, now, loc); changed {
		t.Error("future expiry must not change")
	}
	b = billingWith("lifetime", 0, "2020-01-01")
	if _, changed := renewedExpiry(b, now, loc); changed {
		t.Error("lifetime has no cycle to add")
	}
}

func TestDaysLeft(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 9, 18, 23, 59, 0, 0, loc)
	if d, ok := daysLeft(billingWith("monthly", 0, "2026-09-25"), now, loc); !ok || d != 7 {
		t.Errorf("got %d ok=%v want 7", d, ok)
	}
	if d, ok := daysLeft(billingWith("monthly", 0, "2026-09-18"), now, loc); !ok || d != 0 {
		t.Errorf("today: got %d ok=%v want 0", d, ok)
	}
	if _, ok := daysLeft(billingWith("free", 0, ""), now, loc); ok {
		t.Error("free has no expiry")
	}
}

package hub

import (
	"math"
	"time"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

// dateClamped returns midnight on day d of month m in loc, clamping d to the
// month's length. m may be outside 1..12; time.Date normalizes it.
func dateClamped(y int, m time.Month, d int, loc *time.Location) time.Time {
	first := time.Date(y, m, 1, 0, 0, 0, 0, loc)
	last := first.AddDate(0, 1, -1).Day()
	if d > last {
		d = last
	}
	if d < 1 {
		d = 1
	}
	return time.Date(first.Year(), first.Month(), d, 0, 0, 0, 0, loc)
}

// trafficPeriod returns the current traffic accounting window for a reset day.
func trafficPeriod(now time.Time, resetDay int, loc *time.Location) (start, end time.Time) {
	local := now.In(loc)
	start = dateClamped(local.Year(), local.Month(), resetDay, loc)
	if start.After(local) {
		start = dateClamped(local.Year(), local.Month()-1, resetDay, loc)
	}
	end = dateClamped(start.Year(), start.Month()+1, resetDay, loc)
	return start, end
}

func countedTraffic(mode string, rx, tx int64) int64 {
	switch mode {
	case "rx":
		return rx
	case "tx":
		return tx
	case "max":
		return max(rx, tx)
	default:
		return rx + tx
	}
}

func parseDay(s string, loc *time.Location) (time.Time, bool) {
	t, err := time.ParseInLocation("2006-01-02", s, loc)
	return t, err == nil
}

// daysLeft returns whole days until the expiry date in loc; ok is false when
// there is no expiry.
func daysLeft(b store.Billing, now time.Time, loc *time.Location) (int, bool) {
	if b.Cycle == "free" || b.Cycle == "lifetime" || b.ExpiresAt == "" {
		return 0, false
	}
	exp, ok := parseDay(b.ExpiresAt, loc)
	if !ok {
		return 0, false
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return int(math.Round(exp.Sub(today).Hours() / 24)), true
}

func addCycle(t time.Time, b store.Billing) (time.Time, bool) {
	switch b.Cycle {
	case "monthly":
		return t.AddDate(0, 1, 0), true
	case "quarterly":
		return t.AddDate(0, 3, 0), true
	case "semiannual":
		return t.AddDate(0, 6, 0), true
	case "yearly":
		return t.AddDate(1, 0, 0), true
	case "custom":
		if b.Days > 0 {
			return t.AddDate(0, 0, b.Days), true
		}
	}
	return t, false
}

// renewedExpiry advances an expiry that has passed by whole cycles until it is
// in the future. changed is false when nothing needed to move.
func renewedExpiry(b store.Billing, now time.Time, loc *time.Location) (string, bool) {
	exp, ok := parseDay(b.ExpiresAt, loc)
	if !ok {
		return "", false
	}
	local := now.In(loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	changed := false
	for i := 0; i < 1000 && exp.Before(today); i++ {
		next, ok := addCycle(exp, b)
		if !ok {
			return "", false
		}
		exp, changed = next, true
	}
	return exp.Format("2006-01-02"), changed
}

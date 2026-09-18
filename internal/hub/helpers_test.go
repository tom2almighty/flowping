package hub

import "github.com/tom2almighty/flowping/internal/hub/store"

func billingWith(cycle string, days int, expiresAt string) store.Billing {
	return store.Billing{Cycle: cycle, Days: days, ExpiresAt: expiresAt}
}

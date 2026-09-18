// Package buildinfo turns the linker-injected version into something to show.
package buildinfo

import "strings"

// Display normalizes a build version so every source agrees on one form:
// release tags get exactly one leading v, development builds stay "dev".
// It absorbs both goreleaser's bare "0.0.2" and a docker build arg of "v0.0.2".
func Display(v string) string {
	if v == "" || v == "dev" {
		return "dev"
	}
	return "v" + strings.TrimPrefix(v, "v")
}

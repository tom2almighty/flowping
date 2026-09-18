// Package web embeds the built frontend. Run `bun run build` in this
// directory before building the hub binary.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS

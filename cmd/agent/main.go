package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/tom2almighty/flowping/internal/agent"
)

var version = "dev"

func main() {
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}

	fs := flag.NewFlagSet("flowping-agent", flag.ExitOnError)
	hub := fs.String("hub", env("FLOWPING_HUB", ""), "hub base URL, e.g. https://ping.example.com")
	token := fs.String("token", env("FLOWPING_TOKEN", ""), "agent token issued by the hub")
	root := fs.String("root", env("FLOWPING_ROOT", "/"), "host root path (use /host inside docker)")
	level := fs.String("log-level", env("FLOWPING_LOG_LEVEL", "info"), "log level: debug|info|warn|error")
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, `Usage: flowping-agent [command] [flags]

Commands:
  (none)      run the agent in the foreground
  install     write a systemd unit and start the service (root)
  uninstall   stop the service and remove the unit (root)
  version     print the version

Flags:
`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)

	switch cmd {
	case "version":
		fmt.Println(version)
		return
	case "install":
		requireHubToken(*hub, *token)
		if err := agent.Install(strings.TrimRight(*hub, "/"), *token); err != nil {
			fmt.Fprintln(os.Stderr, "install failed:", err)
			os.Exit(1)
		}
		fmt.Println("flowping-agent.service installed and started")
		return
	case "uninstall":
		if err := agent.Uninstall(); err != nil {
			fmt.Fprintln(os.Stderr, "uninstall failed:", err)
			os.Exit(1)
		}
		fmt.Println("flowping-agent.service removed")
		return
	case "":
	default:
		fs.Usage()
		os.Exit(2)
	}

	requireHubToken(*hub, *token)
	log := newLogger(*level)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	a := agent.New(agent.Options{
		Hub:     strings.TrimRight(*hub, "/"),
		Token:   *token,
		Root:    *root,
		Version: version,
		Log:     log,
	})
	a.Run(ctx)
}

func requireHubToken(hub, token string) {
	if hub == "" || token == "" {
		fmt.Fprintln(os.Stderr, "--hub and --token are required (or FLOWPING_HUB / FLOWPING_TOKEN)")
		os.Exit(2)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	if err := l.UnmarshalText([]byte(level)); err != nil {
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}

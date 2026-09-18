package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	unitPath = "/etc/systemd/system/flowping-agent.service"
	envPath  = "/etc/flowping-agent.env"
)

// Install writes the env file and systemd unit for the running binary, then
// enables and (re)starts the service.
func Install(hub, token string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("must run as root")
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return fmt.Errorf("systemctl not found; run the agent under your own supervisor instead")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if exe, err = filepath.EvalSymlinks(exe); err != nil {
		return err
	}
	env := fmt.Sprintf("FLOWPING_HUB=%s\nFLOWPING_TOKEN=%s\n", hub, token)
	if err := os.WriteFile(envPath, []byte(env), 0o600); err != nil {
		return err
	}
	unit := fmt.Sprintf(`[Unit]
Description=FlowPing agent
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=%s
ExecStart=%s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`, envPath, exe)
	if err := os.WriteFile(unitPath, []byte(unit), 0o644); err != nil {
		return err
	}
	for _, args := range [][]string{
		{"daemon-reload"},
		{"enable", "flowping-agent"},
		{"restart", "flowping-agent"},
	} {
		if err := systemctl(args...); err != nil {
			return err
		}
	}
	return nil
}

func Uninstall() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("must run as root")
	}
	_ = systemctl("disable", "--now", "flowping-agent")
	for _, p := range []string{unitPath, envPath} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return systemctl("daemon-reload")
}

func systemctl(args ...string) error {
	cmd := exec.Command("systemctl", args...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("systemctl %v: %w", args, err)
	}
	return nil
}

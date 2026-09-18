package hub

import (
	"os"
	"strings"
)

type Config struct {
	Listen             string
	DataDir            string
	BaseURL            string // public URL of the hub; used in install commands and the GitHub callback
	AdminPassword      string // initial password, used only while none is stored
	GitHubClientID     string
	GitHubClientSecret string
	TrustProxy         bool // read the client IP from CF-Connecting-IP / X-Real-IP / X-Forwarded-For
	AgentImage         string
	ReleaseURL         string // where install.sh downloads agent archives from
	LogLevel           string
}

func LoadConfig() Config {
	return Config{
		Listen:             env("FLOWPING_LISTEN", ":8080"),
		DataDir:            env("FLOWPING_DATA", "./data"),
		BaseURL:            strings.TrimRight(env("FLOWPING_BASE_URL", ""), "/"),
		AdminPassword:      env("FLOWPING_ADMIN_PASSWORD", ""),
		GitHubClientID:     env("FLOWPING_GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: env("FLOWPING_GITHUB_CLIENT_SECRET", ""),
		TrustProxy:         env("FLOWPING_TRUST_PROXY", "false") == "true",
		AgentImage:         env("FLOWPING_AGENT_IMAGE", "ghcr.io/tom2almighty/flowping-agent"),
		ReleaseURL:         strings.TrimRight(env("FLOWPING_RELEASE_URL", "https://github.com/tom2almighty/flowping/releases/latest/download"), "/"),
		LogLevel:           env("FLOWPING_LOG_LEVEL", "info"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

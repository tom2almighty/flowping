package hub

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/tom2almighty/flowping/web"
)

// spaHandler serves the embedded frontend; unknown paths fall back to
// index.html so client-side routes work on reload.
func (h *Hub) spaHandler() http.Handler {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(err)
	}
	files := http.FS(dist)
	index, indexErr := fs.ReadFile(dist, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if p != "/" {
			if f, err := files.Open(p); err == nil {
				st, statErr := f.Stat()
				f.Close()
				if statErr == nil && !st.IsDir() {
					if strings.HasPrefix(p, "/assets/") {
						w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
					}
					http.FileServer(files).ServeHTTP(w, r)
					return
				}
			}
		}
		if indexErr != nil {
			http.Error(w, "frontend not built: run `bun run build` in web/ before building the hub", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}

const installScript = `#!/bin/sh
# FlowPing agent installer: downloads the release binary for this CPU and
# registers a systemd service. Usage:
#   curl -fsSL https://hub.example.com/install.sh | sh -s -- --hub https://hub.example.com --token TOKEN
set -eu

HUB=""
TOKEN=""
RELEASE="__RELEASE_URL__"
while [ $# -gt 0 ]; do
  case "$1" in
    --hub) HUB="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$HUB" ] || [ -z "$TOKEN" ]; then
  echo "usage: install.sh --hub URL --token TOKEN" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv7|armhf) ARCH=armv7 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="$RELEASE/flowping-agent_linux_$ARCH.tar.gz"
echo "downloading $URL"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP/agent.tar.gz"
else
  wget -qO "$TMP/agent.tar.gz" "$URL"
fi
tar -xzf "$TMP/agent.tar.gz" -C "$TMP"
install -m 755 "$TMP/flowping-agent" /usr/local/bin/flowping-agent
/usr/local/bin/flowping-agent install --hub "$HUB" --token "$TOKEN"
echo "done: journalctl -u flowping-agent -f to follow the log"
`

func (h *Hub) handleInstallScript(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	_, _ = w.Write([]byte(strings.ReplaceAll(installScript, "__RELEASE_URL__", h.cfg.ReleaseURL)))
}

package hub

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/nicholas-fedor/shoutrrr"
	"github.com/nicholas-fedor/shoutrrr/pkg/types"

	"github.com/tom2almighty/flowping/internal/hub/store"
)

// notify records an event and fans it out to every enabled channel.
func (h *Hub) notify(ctx context.Context, agentID, kind, level, message string) {
	h.log.Info("event", "agent", agentID, "kind", kind, "level", level, "message", message)
	if err := h.db.AddEvent(ctx, store.Event{TS: time.Now().Unix(), AgentID: agentID, Kind: kind, Level: level, Message: message}); err != nil {
		h.log.Error("store event", "err", err)
	}
	chs, err := h.db.ListChannels(ctx)
	if err != nil {
		return
	}
	var urls []string
	for _, c := range chs {
		if c.Enabled {
			urls = append(urls, c.URL)
		}
	}
	if len(urls) == 0 {
		return
	}
	title := h.setting("site_name")
	go func() {
		if err := sendNotification(urls, title, message); err != nil {
			h.log.Error("notify failed", "err", err)
		}
	}()
}

func sendNotification(urls []string, title, message string) error {
	sender, err := shoutrrr.CreateSender(urls...)
	if err != nil {
		return err
	}
	params := types.Params{"title": title}
	var errs []string
	for _, e := range sender.Send(message, &params) {
		if e != nil {
			errs = append(errs, e.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

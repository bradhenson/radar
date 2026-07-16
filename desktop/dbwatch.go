package main

import (
	"context"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// External-write detection.
//
// RADAR holds every record in memory and writes through per record, so a
// second writer (the optional MCP server in mcp/) would otherwise be invisible
// here: its changes would not appear, and editing the same record afterwards
// would silently overwrite them from stale state — exactly what plan rule 18
// forbids. The MCP server stamps app_meta.external_write_at inside the same
// transaction as each write; this poller notices the new value and asks the
// frontend to re-read.
//
// This is a cooperative signal, not a general filesystem watcher: it detects
// writers that stamp the key (our MCP server), which is the only supported
// second writer. RADAR's own writes never touch the key, so there is no
// "was that me?" ambiguity and no reload loop.
const (
	externalWriteKey = "external_write_at"
	// Fast enough to feel live while an LLM works, cheap enough to ignore:
	// one indexed lookup on a single-row key.
	externalWritePollInterval = 1500 * time.Millisecond
	// databaseChangedEvent is consumed by src/stores/app.svelte.ts.
	databaseChangedEvent = "radar:database-changed"
)

// watchExternalWrites runs until ctx is cancelled (app shutdown).
func watchExternalWrites(ctx context.Context, store *Store) {
	// Seed with the value present at startup: the app has just loaded that
	// state, so it is not a change to report.
	last, err := store.externalWriteToken()
	if err != nil {
		return
	}
	ticker := time.NewTicker(externalWritePollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			token, err := store.externalWriteToken()
			// A transient read error (busy database mid-write) is not worth
			// reporting; the next tick retries.
			if err != nil || token == last {
				continue
			}
			last = token
			runtime.EventsEmit(ctx, databaseChangedEvent)
		}
	}
}

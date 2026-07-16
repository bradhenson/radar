package main

import "testing"

// The watcher's Wails event emission needs a live runtime context, so these
// tests cover the signal-reading contract it depends on: RADAR's own writes
// must never look like an external change, and a stamped key must be visible.

func TestExternalWriteTokenEmptyOnFreshDatabase(t *testing.T) {
	store := openTestStore(t)
	token, err := store.externalWriteToken()
	if err != nil {
		t.Fatalf("externalWriteToken: %v", err)
	}
	if token != "" {
		t.Fatalf("fresh database reported an external write: %q", token)
	}
}

func TestStoreWritesDoNotStampExternalWriteKey(t *testing.T) {
	store := openTestStore(t)
	// Every write path the frontend can reach must leave the key untouched,
	// or the desktop window would reload in response to its own writes.
	if err := store.Put("tasks", task("t1", "First")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := store.Mutate(`[{"kind":"put","collection":"tasks","record":{"id":"t2","title":"Second","status":"open"}}]`); err != nil {
		t.Fatalf("Mutate: %v", err)
	}
	if err := store.SaveMeta(`{"databaseId":"d1","changesSinceBackup":2}`); err != nil {
		t.Fatalf("SaveMeta: %v", err)
	}
	if err := store.Delete("tasks", "t1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	token, err := store.externalWriteToken()
	if err != nil {
		t.Fatalf("externalWriteToken: %v", err)
	}
	if token != "" {
		t.Fatalf("a RADAR write stamped the external-write key: %q", token)
	}
}

func TestExternalWriteTokenReportsStampedValue(t *testing.T) {
	store := openTestStore(t)
	// Stand in for the MCP server (mcp/src/db.ts stamps this key in the same
	// transaction as its writes).
	if _, err := store.db.Exec(
		`INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		externalWriteKey, "2026-07-15T18:00:00.000Z#abc"); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	token, err := store.externalWriteToken()
	if err != nil {
		t.Fatalf("externalWriteToken: %v", err)
	}
	if token != "2026-07-15T18:00:00.000Z#abc" {
		t.Fatalf("unexpected token %q", token)
	}
}

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSelectedDatabasePathRoundTripAndResolution(t *testing.T) {
	localAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	selected := filepath.Join(t.TempDir(), "RADAR data", "supervisor.db")

	if err := saveSelectedDbPath(selected); err != nil {
		t.Fatalf("saveSelectedDbPath: %v", err)
	}
	gotPath, err := readSelectedDbPath()
	if err != nil {
		t.Fatalf("readSelectedDbPath: %v", err)
	}
	if gotPath != selected {
		t.Fatalf("selected database = %q, want %q", gotPath, selected)
	}
	resolved, err := resolveDbPath()
	if err != nil {
		t.Fatalf("resolveDbPath: %v", err)
	}
	if resolved != selected {
		t.Fatalf("database path = %q, want %q", resolved, selected)
	}
}

func TestInvalidDatabaseLocationPreferenceIsRejected(t *testing.T) {
	localAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	preferencePath, err := databaseLocationFile()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(preferencePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preferencePath, []byte(`{"directory":"relative"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSelectedDbPath(); err == nil {
		t.Fatal("relative selected path should be rejected")
	}
}

func TestLegacySelectedDatabaseDirectoryMigratesOnRead(t *testing.T) {
	localAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	directory := filepath.Join(t.TempDir(), "legacy")
	preferencePath, err := databaseLocationFile()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(preferencePath), 0o700); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"directory":"` + filepath.ToSlash(directory) + `"}`)
	if err := os.WriteFile(preferencePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readSelectedDbPath()
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(directory, "radar.db"); got != want {
		t.Fatalf("legacy path = %q, want %q", got, want)
	}
}

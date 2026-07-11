package main

import (
	"errors"
	"os"
	"path/filepath"
)

// resolveDbPath picks the SQLite file location (plan section 8.10):
//   - Portable mode: a radar.db sitting next to the executable wins, so the
//     app and its data can travel together on removable or synced storage.
//   - Default: %LOCALAPPDATA%\RADAR\radar.db. Roaming AppData is deliberately
//     avoided — roaming profiles sync to network shares, which is a
//     data-handling concern for supervisory notes.
func resolveDbPath() (string, error) {
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "radar.db")
		if _, err := os.Stat(portable); err == nil {
			return portable, nil
		}
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", errors.New("cannot resolve LOCALAPPDATA or a home directory")
		}
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "RADAR", "radar.db"), nil
}

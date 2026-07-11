package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const databaseLocationFilename = "database-location.json"

// resolveDbPath picks the SQLite file location (plan section 8.10):
//   - Portable mode: a radar.db sitting next to the executable wins, so the
//     app and its data can travel together on removable or synced storage.
//   - Default: %LOCALAPPDATA%\RADAR\radar.db. Roaming AppData is deliberately
//     avoided — roaming profiles sync to network shares, which is a
//     data-handling concern for supervisory notes.
func resolveDbPath() (string, error) {
	if selected, err := readSelectedDbPath(); err != nil {
		return "", err
	} else if selected != "" {
		return selected, nil
	}
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "radar.db")
		if _, err := os.Stat(portable); err == nil {
			return portable, nil
		}
	}
	dir, err := localDataDirectory()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "radar.db"), nil
}

func localDataDirectory() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", errors.New("cannot resolve LOCALAPPDATA or a home directory")
		}
		base = filepath.Join(home, "AppData", "Local")
	}
	return filepath.Join(base, "RADAR"), nil
}

func databaseLocationFile() (string, error) {
	dir, err := localDataDirectory()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, databaseLocationFilename), nil
}

func readSelectedDbPath() (string, error) {
	path, err := databaseLocationFile()
	if err != nil {
		return "", err
	}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read database location preference: %w", err)
	}
	var preference struct {
		DatabasePath string `json:"databasePath"`
		Directory    string `json:"directory"`
	}
	if err := json.Unmarshal(raw, &preference); err != nil {
		return "", fmt.Errorf("read database location preference: %w", err)
	}
	// Migrate the folder-based preference written by the first version of
	// this feature without making the user reselect their database.
	if preference.DatabasePath == "" && preference.Directory != "" {
		preference.DatabasePath = filepath.Join(preference.Directory, "radar.db")
	}
	if preference.DatabasePath == "" || !filepath.IsAbs(preference.DatabasePath) {
		return "", errors.New("database location preference is not an absolute file path")
	}
	return filepath.Clean(preference.DatabasePath), nil
}

func saveSelectedDbPath(databasePath string) error {
	if databasePath == "" || !filepath.IsAbs(databasePath) {
		return errors.New("database path must be absolute")
	}
	path, err := databaseLocationFile()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create preference directory: %w", err)
	}
	raw, err := json.Marshal(struct {
		DatabasePath string `json:"databasePath"`
	}{DatabasePath: filepath.Clean(databasePath)})
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return fmt.Errorf("write database location preference: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		os.Remove(temporary)
		return fmt.Errorf("save database location preference: %w", err)
	}
	return nil
}

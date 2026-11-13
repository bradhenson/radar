package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Automatic backups. The frontend builds the same JSON backup package a
// manual export produces and hands it here; this file only decides where it
// goes, writes it without ever leaving a half-written file behind, and keeps
// the newest N days. There is one file per database per day: a later save on
// the same day replaces that day's file, so "keep 14" means two weeks of
// history rather than fourteen saves from one busy afternoon.
//
// The folder is chosen only through the native folder dialog and remembered
// in a per-machine preference file. The frontend never passes a path, so
// nothing in an imported backup or a stored setting can point a write at an
// arbitrary location; it supplies only a filename, which must match
// autoBackupNamePattern exactly.

const (
	autoBackupLocationFilename = "backup-location.json"
	autoBackupFolderName       = "backups"
	autoBackupMinKeep          = 1
	autoBackupMaxKeep          = 365
)

// RADAR_AutoBackup_<database id fragment>_<YYYY-MM-DD>.json
var autoBackupNamePattern = regexp.MustCompile(`^RADAR_AutoBackup_([A-Za-z0-9]{1,16})_(\d{4}-\d{2}-\d{2})\.json$`)

// AutoBackupInfo is returned to the frontend as JSON (wailsBridge.ts).
type AutoBackupInfo struct {
	Folder    string `json:"folder"`
	IsDefault bool   `json:"isDefault"`
	// Files in the folder that are automatic backups of any database.
	Count int `json:"count"`
	// Newest automatic backup by name (dates sort lexically), "" when none.
	LatestName     string `json:"latestName"`
	LatestModified string `json:"latestModified"`
	// Set by a write: whether this day's file was new rather than replaced.
	Created bool `json:"created"`
}

func defaultAutoBackupFolder(dbPath string) string {
	return filepath.Join(filepath.Dir(dbPath), autoBackupFolderName)
}

func autoBackupLocationFile() (string, error) {
	dir, err := localDataDirectory()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, autoBackupLocationFilename), nil
}

// readSelectedBackupFolder returns "" when no folder has been chosen. A
// preference that is unreadable or not an absolute path is treated as "not
// chosen" rather than an error: backups must keep working in the default
// folder even if the preference file is damaged.
func readSelectedBackupFolder() string {
	path, err := autoBackupLocationFile()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var preference struct {
		Folder string `json:"folder"`
	}
	if err := json.Unmarshal(raw, &preference); err != nil {
		return ""
	}
	if preference.Folder == "" || !filepath.IsAbs(preference.Folder) {
		return ""
	}
	return filepath.Clean(preference.Folder)
}

func saveSelectedBackupFolder(folder string) error {
	path, err := autoBackupLocationFile()
	if err != nil {
		return err
	}
	if folder == "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("clear backup folder preference: %w", err)
		}
		return nil
	}
	if !filepath.IsAbs(folder) {
		return errors.New("backup folder must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create preference directory: %w", err)
	}
	raw, err := json.Marshal(struct {
		Folder string `json:"folder"`
	}{Folder: filepath.Clean(folder)})
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return fmt.Errorf("write backup folder preference: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		os.Remove(temporary)
		return fmt.Errorf("save backup folder preference: %w", err)
	}
	return nil
}

func clampAutoBackupKeep(keep int) int {
	if keep < autoBackupMinKeep {
		return autoBackupMinKeep
	}
	if keep > autoBackupMaxKeep {
		return autoBackupMaxKeep
	}
	return keep
}

// autoBackupFiles lists the automatic backups in folder, newest first. With a
// non-empty databaseFragment only that database's files are returned.
func autoBackupFiles(folder, databaseFragment string) ([]string, error) {
	entries, err := os.ReadDir(folder)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read backup folder: %w", err)
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := autoBackupNamePattern.FindStringSubmatch(entry.Name())
		if match == nil {
			continue
		}
		if databaseFragment != "" && match[1] != databaseFragment {
			continue
		}
		names = append(names, entry.Name())
	}
	// Newest date first; the date is the last underscore-separated part, so
	// sort on it rather than on the whole name (fragments differ in length).
	sort.Slice(names, func(i, j int) bool {
		di := autoBackupNamePattern.FindStringSubmatch(names[i])[2]
		dj := autoBackupNamePattern.FindStringSubmatch(names[j])[2]
		if di != dj {
			return di > dj
		}
		return names[i] < names[j]
	})
	return names, nil
}

// writeAutoBackup saves content as folder/name and prunes that database's
// older files beyond keep. The write goes to a temporary file first and is
// renamed into place, so an interrupted save never truncates the day's
// existing backup. Returns whether the day's file was newly created.
func writeAutoBackup(folder, name, content string, keep int) (bool, error) {
	match := autoBackupNamePattern.FindStringSubmatch(name)
	if match == nil {
		return false, errors.New("automatic backup filename is not valid")
	}
	if strings.TrimSpace(content) == "" {
		return false, errors.New("automatic backup has no content")
	}
	if folder == "" || !filepath.IsAbs(folder) {
		return false, errors.New("backup folder must be an absolute path")
	}
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return false, fmt.Errorf("create backup folder: %w", err)
	}
	target := filepath.Join(folder, name)
	_, statErr := os.Stat(target)
	created := os.IsNotExist(statErr)

	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, []byte(content), 0o600); err != nil {
		os.Remove(temporary)
		return false, fmt.Errorf("write automatic backup: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		os.Remove(temporary)
		return false, fmt.Errorf("save automatic backup: %w", err)
	}

	// Pruning is best effort: the new backup is already safely on disk, so a
	// file that cannot be removed must not turn a successful save into an error.
	if names, err := autoBackupFiles(folder, match[1]); err == nil {
		for _, old := range names[min(len(names), clampAutoBackupKeep(keep)):] {
			os.Remove(filepath.Join(folder, old))
		}
	}
	return created, nil
}

func autoBackupInfo(folder string, isDefault bool) (AutoBackupInfo, error) {
	info := AutoBackupInfo{Folder: folder, IsDefault: isDefault}
	names, err := autoBackupFiles(folder, "")
	if err != nil {
		return info, err
	}
	info.Count = len(names)
	if len(names) > 0 {
		info.LatestName = names[0]
		if stat, err := os.Stat(filepath.Join(folder, names[0])); err == nil {
			info.LatestModified = stat.ModTime().UTC().Format(time.RFC3339)
		}
	}
	return info, nil
}

func (a *App) autoBackupFolder() (string, bool) {
	if selected := readSelectedBackupFolder(); selected != "" {
		return selected, false
	}
	return defaultAutoBackupFolder(a.store.dbPath), true
}

func (a *App) autoBackupInfoJSON(created bool) (string, error) {
	folder, isDefault := a.autoBackupFolder()
	info, err := autoBackupInfo(folder, isDefault)
	if err != nil {
		return "", err
	}
	info.Created = created
	raw, err := json.Marshal(info)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// GetAutoBackupInfo reports where automatic backups go and what is there.
func (a *App) GetAutoBackupInfo() (string, error) {
	return a.autoBackupInfoJSON(false)
}

// WriteAutoBackup saves one automatic backup into the configured folder and
// returns the folder's updated AutoBackupInfo as JSON.
func (a *App) WriteAutoBackup(name, content string, keep int) (string, error) {
	folder, _ := a.autoBackupFolder()
	created, err := writeAutoBackup(folder, name, content, keep)
	if err != nil {
		return "", err
	}
	return a.autoBackupInfoJSON(created)
}

// ChooseAutoBackupFolder opens a native folder dialog and remembers the
// choice. Returns "" when the user cancels, otherwise the updated info JSON.
func (a *App) ChooseAutoBackupFolder() (string, error) {
	current, _ := a.autoBackupFolder()
	startIn := current
	if _, err := os.Stat(startIn); err != nil {
		startIn = filepath.Dir(a.store.dbPath)
	}
	folder, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose a folder for automatic backups",
		DefaultDirectory:     startIn,
		CanCreateDirectories: true,
	})
	if err != nil {
		return "", err
	}
	if folder == "" {
		return "", nil
	}
	folder, err = filepath.Abs(folder)
	if err != nil {
		return "", fmt.Errorf("resolve backup folder: %w", err)
	}
	if err := saveSelectedBackupFolder(folder); err != nil {
		return "", err
	}
	return a.autoBackupInfoJSON(false)
}

// ResetAutoBackupFolder returns to the default folder beside the database.
func (a *App) ResetAutoBackupFolder() (string, error) {
	if err := saveSelectedBackupFolder(""); err != nil {
		return "", err
	}
	return a.autoBackupInfoJSON(false)
}

// OpenAutoBackupFolder reveals the automatic backup folder in File Explorer.
func (a *App) OpenAutoBackupFolder() error {
	folder, _ := a.autoBackupFolder()
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return fmt.Errorf("create backup folder: %w", err)
	}
	if err := exec.Command("explorer.exe", folder).Start(); err != nil {
		return fmt.Errorf("open backup folder: %w", err)
	}
	return nil
}

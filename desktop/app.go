package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound into the Wails runtime as window.go.main.App
// (src/data/wailsBridge.ts AppBindings).
type App struct {
	ctx   context.Context
	store *Store
}

func NewApp(store *Store) *App { return &App{store: store} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

// onSecondInstance surfaces the existing window when the user launches the
// app again (single-instance lock in main.go).
func (a *App) onSecondInstance(_ options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
}

// SaveTextFile opens a native save dialog and writes the content to the
// chosen location. Returns the saved path, or "" when the user cancels —
// the frontend treats a cancel as "export did not happen" (the backup
// reminder must not reset).
func (a *App) SaveTextFile(defaultFilename, content string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save file",
		DefaultFilename: defaultFilename,
		Filters:         []runtime.FileFilter{filterFor(defaultFilename)},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", fmt.Errorf("could not write %s: %w", filepath.Base(path), err)
	}
	return path, nil
}

func (a *App) OpenDatabaseFile() (string, error) {
	currentDirectory := filepath.Dir(a.store.dbPath)
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open RADAR database",
		DefaultDirectory: currentDirectory,
		Filters: []runtime.FileFilter{
			{DisplayName: "RADAR database (*.db)", Pattern: "*.db"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve selected database: %w", err)
	}
	if strings.ToLower(filepath.Ext(path)) != ".db" {
		return "", errors.New("select a database file ending in .db")
	}
	if err := ValidateRadarDatabase(path); err != nil {
		return "", err
	}
	return a.switchDatabase(path)
}

func (a *App) CreateDatabaseFile() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Create RADAR database",
		DefaultDirectory: filepath.Dir(a.store.dbPath),
		DefaultFilename:  "radar.db",
		Filters: []runtime.FileFilter{
			{DisplayName: "RADAR database (*.db)", Pattern: "*.db"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if filepath.Ext(path) == "" {
		path += ".db"
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve new database path: %w", err)
	}
	if strings.ToLower(filepath.Ext(path)) != ".db" {
		return "", errors.New("new database filename must end in .db")
	}
	if _, err := os.Stat(path); err == nil {
		return "", errors.New("a file already exists at that location; choose a new filename")
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("check new database path: %w", err)
	}
	return a.switchDatabase(path)
}

// switchDatabase opens the replacement before changing the live connection.
// The current database remains active if opening or saving the preference fails.
func (a *App) switchDatabase(path string) (string, error) {
	if filepath.Clean(path) == filepath.Clean(a.store.dbPath) {
		return a.store.dbPath, nil
	}
	newStore, err := OpenStore(path)
	if err != nil {
		return "", err
	}
	if err := saveSelectedDbPath(path); err != nil {
		newStore.closeDB()
		return "", err
	}
	oldDB := a.store.db
	a.store.db = newStore.db
	a.store.dbPath = newStore.dbPath
	newStore.db = nil
	if err := oldDB.Close(); err != nil {
		return "", fmt.Errorf("close previous database: %w", err)
	}
	return a.store.dbPath, nil
}

// OpenDatabaseFolder reveals the active radar.db location in File Explorer.
func (a *App) OpenDatabaseFolder() error {
	directory := filepath.Dir(a.store.dbPath)
	if err := exec.Command("explorer.exe", directory).Start(); err != nil {
		return fmt.Errorf("open database folder: %w", err)
	}
	return nil
}

func filterFor(filename string) runtime.FileFilter {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".json":
		return runtime.FileFilter{DisplayName: "JSON files (*.json)", Pattern: "*.json"}
	case ".csv":
		return runtime.FileFilter{DisplayName: "CSV files (*.csv)", Pattern: "*.csv"}
	case ".txt":
		return runtime.FileFilter{DisplayName: "Text files (*.txt)", Pattern: "*.txt"}
	default:
		return runtime.FileFilter{DisplayName: "All files (*.*)", Pattern: "*.*"}
	}
}

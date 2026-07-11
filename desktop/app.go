package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is bound into the Wails runtime as window.go.main.App
// (src/data/wailsBridge.ts AppBindings).
type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

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

// Desktop shell for RADAR (Project_Plan section 8.10). Embeds the same
// single-file frontend that ships as dist/radar.html and serves it through
// the Wails asset server; persistence is SQLite via the bound Store. This is
// an optional distribution — dist/radar.html over file:// remains the
// primary artifact.
package main

import (
	"embed"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// dist/index.html is copied from the repo dist/ by
// scripts/copy-desktop-assets.mjs (go:embed cannot reference parent paths).
//
//go:embed all:dist
var assets embed.FS

func main() {
	dbPath, err := resolveDbPath()
	if err != nil {
		fatal(fmt.Sprintf("RADAR could not determine a database location.\n\n%v", err))
		return
	}
	// Never launch with a broken store: a failed open (corrupt file, no
	// write access) must not fall through to browser storage.
	store, err := OpenStore(dbPath)
	if err != nil {
		fatal(fmt.Sprintf("RADAR could not open its database.\n\nLocation: %s\n\n%v", dbPath, err))
		return
	}
	defer store.closeDB()

	app := NewApp(store)
	err = wails.Run(&options.App{
		Title:            "RADAR",
		Width:            1280,
		Height:           860,
		Frameless:        true,
		WindowStartState: options.Maximised,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "radar-supervisor-cockpit-desktop",
			OnSecondInstanceLaunch: app.onSecondInstance,
		},
		OnStartup: app.startup,
		Bind:      []interface{}{app, store},
	})
	if err != nil {
		fatal(fmt.Sprintf("RADAR could not start its window.\n\n%v", err))
	}
}

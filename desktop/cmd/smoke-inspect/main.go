// smoke-inspect reports the minimum state needed by scripts/smoke-desktop.mjs.
// It is a test utility, not part of the RADAR executable or operational build.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: smoke-inspect <radar.db>")
		os.Exit(2)
	}
	db, err := sql.Open("sqlite", os.Args[1])
	if err != nil {
		fail(err)
	}
	defer db.Close()

	var metaJSON string
	if err := db.QueryRow(`SELECT value FROM app_meta WHERE key = 'meta'`).Scan(&metaJSON); err != nil {
		fail(err)
	}
	var meta struct {
		DatabaseID string `json:"databaseId"`
	}
	if err := json.Unmarshal([]byte(metaJSON), &meta); err != nil || meta.DatabaseID == "" {
		fail(fmt.Errorf("invalid store meta: %s", metaJSON))
	}
	var boardColumns, tasks int
	if err := db.QueryRow(`SELECT count(*) FROM "boardColumns"`).Scan(&boardColumns); err != nil {
		fail(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM "tasks"`).Scan(&tasks); err != nil {
		fail(err)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"databaseId": meta.DatabaseID,
		"boardColumns": boardColumns,
		"tasks": tasks,
	})
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

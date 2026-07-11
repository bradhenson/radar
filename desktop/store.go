// SQLite persistence for the desktop shell (Project_Plan section 8.10).
//
// This is deliberately a dumb, generic record store: records are opaque JSON
// documents stored and returned verbatim (json.RawMessage, never re-marshaled
// through Go structs), so field fidelity matches the backup format exactly
// and future TypeScript model changes need no Go changes. All domain logic,
// migrations, identifier generation, and defaults live in TypeScript; the
// bound method surface mirrors src/data/wailsBridge.ts StoreBindings.
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// collectionNames must stay in sync with COLLECTION_NAMES in
// src/data/DataStore.ts. TestCollectionNamesMatchTypeScript enforces this.
var collectionNames = []string{
	"competencies",
	"employees",
	"projects",
	"tasks",
	"boardColumns",
	"taskNotes",
	"checklistItems",
	"performanceElements",
	"evaluationCycles",
	"performanceInputs",
	"trainingRequirements",
	"employeeTrainingRecords",
	"leaveRecords",
	"teleworkRecords",
	"travelRecords",
	"awardRecords",
	"employeeInteractions",
	"employeeNotes",
	"meetingNotes",
	"activityEntries",
	"attentionSnoozes",
}

var collectionSet = func() map[string]bool {
	set := make(map[string]bool, len(collectionNames))
	for _, name := range collectionNames {
		set[name] = true
	}
	return set
}()

// Store is bound into the Wails runtime as window.go.main.Store. Every
// method takes and returns JSON text; a returned error becomes a rejected
// promise in the frontend.
type Store struct {
	db     *sql.DB
	dbPath string
}

func OpenStore(dbPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// One connection serializes all access. Keep the rollback journal in
	// DELETE mode so radar.db is the complete portable database at every
	// committed write. WAL would allow recent records to live only in a
	// radar.db-wal companion, making a copied radar.db open successfully but
	// appear empty or stale beside the executable.
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=DELETE",
		"PRAGMA busy_timeout=5000",
		"PRAGMA synchronous=NORMAL",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("%s: %w", pragma, err)
		}
	}
	ddl := []string{
		`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	}
	for _, name := range collectionNames {
		ddl = append(ddl, fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`, quoteIdent(name)))
	}
	for _, stmt := range ddl {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("create schema: %w", err)
		}
	}
	if _, err := db.Exec(
		`INSERT INTO app_meta(key, value) VALUES('schema_version', '1') ON CONFLICT(key) DO NOTHING`); err != nil {
		db.Close()
		return nil, fmt.Errorf("write schema version: %w", err)
	}
	return &Store{db: db, dbPath: dbPath}, nil
}

// ValidateRadarDatabase checks an existing file before OpenStore is allowed
// to run schema DDL. This prevents an accidentally selected, unrelated
// SQLite database from being modified by RADAR.
func ValidateRadarDatabase(dbPath string) error {
	stat, err := os.Stat(dbPath)
	if err != nil {
		return fmt.Errorf("open selected database: %w", err)
	}
	if stat.IsDir() {
		return errors.New("selected database is a directory")
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("inspect selected database: %w", err)
	}
	defer db.Close()
	var schemaVersion string
	if err := db.QueryRow(`SELECT value FROM app_meta WHERE key = 'schema_version'`).Scan(&schemaVersion); err != nil {
		return errors.New("selected file is not a RADAR database")
	}
	if schemaVersion != "1" {
		return fmt.Errorf("unsupported RADAR database schema version %q", schemaVersion)
	}
	return nil
}

// closeDB is deliberately unexported: exported methods on Store are bound
// into the frontend as window.go.main.Store.*, and the frontend must never
// be able to close the database.
func (s *Store) closeDB() error {
	return s.db.Close()
}

// quoteIdent quotes a SQL identifier. Identifiers only ever come from the
// compile-time collectionNames allowlist, never from the frontend.
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func validCollection(name string) error {
	if !collectionSet[name] {
		return fmt.Errorf("unknown collection: %q", name)
	}
	return nil
}

func recordID(recordJSON []byte) (string, error) {
	var probe struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(recordJSON, &probe); err != nil {
		return "", fmt.Errorf("record is not valid JSON: %w", err)
	}
	if probe.ID == "" {
		return "", fmt.Errorf("record has no id")
	}
	return probe.ID, nil
}

func (s *Store) GetAll(collection string) (string, error) {
	if err := validCollection(collection); err != nil {
		return "", err
	}
	rows, err := s.db.Query(
		fmt.Sprintf(`SELECT data FROM %s ORDER BY rowid`, quoteIdent(collection)))
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var records []string
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return "", err
		}
		records = append(records, data)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return "[" + strings.Join(records, ",") + "]", nil
}

func upsert(q interface {
	Exec(query string, args ...any) (sql.Result, error)
}, collection, id, data string) error {
	_, err := q.Exec(fmt.Sprintf(
		`INSERT INTO %s(id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
		quoteIdent(collection)), id, data)
	return err
}

func (s *Store) Put(collection, recordJSON string) error {
	if err := validCollection(collection); err != nil {
		return err
	}
	id, err := recordID([]byte(recordJSON))
	if err != nil {
		return err
	}
	return upsert(s.db, collection, id, recordJSON)
}

func (s *Store) BulkPut(collection, recordsJSON string) error {
	if err := validCollection(collection); err != nil {
		return err
	}
	var records []json.RawMessage
	if err := json.Unmarshal([]byte(recordsJSON), &records); err != nil {
		return fmt.Errorf("records payload is not a JSON array: %w", err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, record := range records {
		id, err := recordID(record)
		if err != nil {
			return err
		}
		if err := upsert(tx, collection, id, string(record)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) Delete(collection, id string) error {
	if err := validCollection(collection); err != nil {
		return err
	}
	_, err := s.db.Exec(
		fmt.Sprintf(`DELETE FROM %s WHERE id = ?`, quoteIdent(collection)), id)
	return err
}

// mutationOp mirrors MutationOp in src/data/DataStore.ts.
type mutationOp struct {
	Kind       string          `json:"kind"`
	Collection string          `json:"collection,omitempty"`
	Record     json.RawMessage `json:"record,omitempty"`
	ID         string          `json:"id,omitempty"`
	Settings   json.RawMessage `json:"settings,omitempty"`
	Meta       json.RawMessage `json:"meta,omitempty"`
}

// Mutate applies a batch of ops as one transaction: a record write, its
// activity entry, and the backup-change counter can never diverge, and a
// cascading deletion cannot stop halfway (DataStore.ts MutationOp contract).
// Every op is validated before any is applied.
func (s *Store) Mutate(opsJSON string) error {
	var ops []mutationOp
	if err := json.Unmarshal([]byte(opsJSON), &ops); err != nil {
		return fmt.Errorf("ops payload is not a JSON array: %w", err)
	}
	type putStep struct{ collection, id, data string }
	type step struct {
		put        *putStep
		deleteFrom string
		deleteID   string
		metaKey    string // "settings" or "meta" for app_meta writes
		metaValue  string
	}
	steps := make([]step, 0, len(ops))
	for _, op := range ops {
		switch op.Kind {
		case "put":
			if err := validCollection(op.Collection); err != nil {
				return err
			}
			id, err := recordID(op.Record)
			if err != nil {
				return err
			}
			steps = append(steps, step{put: &putStep{op.Collection, id, string(op.Record)}})
		case "delete":
			if err := validCollection(op.Collection); err != nil {
				return err
			}
			if op.ID == "" {
				return fmt.Errorf("delete op has no id")
			}
			steps = append(steps, step{deleteFrom: op.Collection, deleteID: op.ID})
		case "saveSettings":
			if len(op.Settings) == 0 {
				return fmt.Errorf("saveSettings op has no settings")
			}
			steps = append(steps, step{metaKey: "settings", metaValue: string(op.Settings)})
		case "saveMeta":
			if len(op.Meta) == 0 {
				return fmt.Errorf("saveMeta op has no meta")
			}
			steps = append(steps, step{metaKey: "meta", metaValue: string(op.Meta)})
		default:
			return fmt.Errorf("unknown op kind: %q", op.Kind)
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, st := range steps {
		switch {
		case st.put != nil:
			if err := upsert(tx, st.put.collection, st.put.id, st.put.data); err != nil {
				return err
			}
		case st.deleteFrom != "":
			if _, err := tx.Exec(fmt.Sprintf(
				`DELETE FROM %s WHERE id = ?`, quoteIdent(st.deleteFrom)), st.deleteID); err != nil {
				return err
			}
		default:
			if err := putAppMeta(tx, st.metaKey, st.metaValue); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func putAppMeta(q interface {
	Exec(query string, args ...any) (sql.Result, error)
}, key, value string) error {
	_, err := q.Exec(
		`INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, value)
	return err
}

func (s *Store) getAppMeta(key string) (string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM app_meta WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func (s *Store) GetSettings() (string, error) { return s.getAppMeta("settings") }

func (s *Store) SaveSettings(settingsJSON string) error {
	if !json.Valid([]byte(settingsJSON)) {
		return fmt.Errorf("settings payload is not valid JSON")
	}
	return putAppMeta(s.db, "settings", settingsJSON)
}

func (s *Store) GetMeta() (string, error) { return s.getAppMeta("meta") }

func (s *Store) SaveMeta(metaJSON string) error {
	if !json.Valid([]byte(metaJSON)) {
		return fmt.Errorf("meta payload is not valid JSON")
	}
	return putAppMeta(s.db, "meta", metaJSON)
}

// ExportSnapshot returns the whole database in DatabaseSnapshot shape.
// settings/meta are null when unset; the TypeScript side substitutes
// defaults (DEFAULT_SETTINGS stays defined in exactly one place).
func (s *Store) ExportSnapshot() (string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var out strings.Builder
	out.WriteString(`{"collections":{`)
	for i, name := range collectionNames {
		if i > 0 {
			out.WriteString(",")
		}
		nameJSON, _ := json.Marshal(name)
		out.Write(nameJSON)
		out.WriteString(":[")
		rows, err := tx.Query(fmt.Sprintf(`SELECT data FROM %s ORDER BY rowid`, quoteIdent(name)))
		if err != nil {
			return "", err
		}
		first := true
		for rows.Next() {
			var data string
			if err := rows.Scan(&data); err != nil {
				rows.Close()
				return "", err
			}
			if !first {
				out.WriteString(",")
			}
			out.WriteString(data)
			first = false
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return "", err
		}
		rows.Close()
		out.WriteString("]")
	}
	out.WriteString(`},"settings":`)
	settings, err := txAppMeta(tx, "settings")
	if err != nil {
		return "", err
	}
	out.WriteString(orNull(settings))
	out.WriteString(`,"meta":`)
	meta, err := txAppMeta(tx, "meta")
	if err != nil {
		return "", err
	}
	out.WriteString(orNull(meta))
	out.WriteString("}")
	return out.String(), tx.Commit()
}

func txAppMeta(tx *sql.Tx, key string) (string, error) {
	var value string
	err := tx.QueryRow(`SELECT value FROM app_meta WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func orNull(value string) string {
	if value == "" {
		return "null"
	}
	return value
}

// ReplaceAll swaps in an entire DatabaseSnapshot (backup import "replace").
func (s *Store) ReplaceAll(snapshotJSON string) error {
	var snapshot struct {
		Collections map[string][]json.RawMessage `json:"collections"`
		Settings    json.RawMessage              `json:"settings"`
		Meta        json.RawMessage              `json:"meta"`
	}
	if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
		return fmt.Errorf("snapshot payload is not valid JSON: %w", err)
	}
	for name := range snapshot.Collections {
		if err := validCollection(name); err != nil {
			return err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, name := range collectionNames {
		if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM %s`, quoteIdent(name))); err != nil {
			return err
		}
		for _, record := range snapshot.Collections[name] {
			id, err := recordID(record)
			if err != nil {
				return err
			}
			if err := upsert(tx, name, id, string(record)); err != nil {
				return err
			}
		}
	}
	if isNullJSON(snapshot.Settings) {
		if _, err := tx.Exec(`DELETE FROM app_meta WHERE key = 'settings'`); err != nil {
			return err
		}
	} else if err := putAppMeta(tx, "settings", string(snapshot.Settings)); err != nil {
		return err
	}
	if isNullJSON(snapshot.Meta) {
		return fmt.Errorf("snapshot has no meta")
	}
	if err := putAppMeta(tx, "meta", string(snapshot.Meta)); err != nil {
		return err
	}
	return tx.Commit()
}

func isNullJSON(raw json.RawMessage) bool {
	return len(raw) == 0 || string(raw) == "null"
}

// ClearAll deletes every record and settings row and writes the fresh meta
// supplied by the frontend (a new databaseId marks the new lineage), all in
// one transaction.
func (s *Store) ClearAll(newMetaJSON string) error {
	if !json.Valid([]byte(newMetaJSON)) {
		return fmt.Errorf("meta payload is not valid JSON")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, name := range collectionNames {
		if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM %s`, quoteIdent(name))); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM app_meta WHERE key = 'settings'`); err != nil {
		return err
	}
	if err := putAppMeta(tx, "meta", newMetaJSON); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetDatabaseInfo() (string, error) {
	info := struct {
		Path        string `json:"path"`
		SizeBytes   int64  `json:"sizeBytes"`
		JournalMode string `json:"journalMode"`
	}{Path: s.dbPath}
	if stat, err := os.Stat(s.dbPath); err == nil {
		info.SizeBytes = stat.Size()
	}
	if err := s.db.QueryRow(`PRAGMA journal_mode`).Scan(&info.JournalMode); err != nil {
		return "", err
	}
	out, err := json.Marshal(info)
	return string(out), err
}

// Mirrors tests/unit/dataStoreContract.ts for the Go SQLite store, plus
// Go-specific guarantees: verbatim JSON fidelity, WAL mode, and the
// TypeScript/Go collection-name sync guard.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "radar.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { store.closeDB() })
	return store
}

func task(id, title string) string {
	return fmt.Sprintf(`{"id":%q,"title":%q,"status":"open"}`, id, title)
}

func allIDs(t *testing.T, store *Store, collection string) []string {
	t.Helper()
	raw, err := store.GetAll(collection)
	if err != nil {
		t.Fatalf("GetAll(%s): %v", collection, err)
	}
	var records []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		t.Fatalf("GetAll(%s) returned invalid JSON: %v", collection, err)
	}
	ids := make([]string, len(records))
	for i, r := range records {
		ids[i] = r.ID
	}
	return ids
}

func expectIDs(t *testing.T, store *Store, collection string, want ...string) {
	t.Helper()
	got := allIDs(t, store, collection)
	sort.Strings(got)
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("%s ids = %v, want %v", collection, got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s ids = %v, want %v", collection, got, want)
		}
	}
}

func TestSettingsUnsetThenRoundTrip(t *testing.T) {
	store := openTestStore(t)
	got, err := store.GetSettings()
	if err != nil || got != "" {
		t.Fatalf("GetSettings on fresh store = %q, %v; want \"\", nil", got, err)
	}
	settings := `{"schemaVersion":2,"theme":"dark"}`
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	got, err = store.GetSettings()
	if err != nil || got != settings {
		t.Fatalf("GetSettings = %q, %v; want %q", got, err, settings)
	}
}

func TestMetaUnsetThenRoundTrip(t *testing.T) {
	store := openTestStore(t)
	got, err := store.GetMeta()
	if err != nil || got != "" {
		t.Fatalf("GetMeta on fresh store = %q, %v; want \"\", nil", got, err)
	}
	meta := `{"databaseId":"db-1","changesSinceBackup":3}`
	if err := store.SaveMeta(meta); err != nil {
		t.Fatalf("SaveMeta: %v", err)
	}
	if got, _ = store.GetMeta(); got != meta {
		t.Fatalf("GetMeta = %q, want %q", got, meta)
	}
}

func TestPutUpsertDelete(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("t1", "one")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := store.Put("tasks", task("t2", "two")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	expectIDs(t, store, "tasks", "t1", "t2")

	if err := store.Put("tasks", task("t1", "renamed")); err != nil {
		t.Fatalf("Put upsert: %v", err)
	}
	raw, _ := store.GetAll("tasks")
	var records []struct{ ID, Title string }
	json.Unmarshal([]byte(raw), &records)
	for _, r := range records {
		if r.ID == "t1" && r.Title != "renamed" {
			t.Fatalf("upsert did not replace record: %+v", r)
		}
	}

	if err := store.Delete("tasks", "t1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	expectIDs(t, store, "tasks", "t2")
	if err := store.Delete("tasks", "missing"); err != nil {
		t.Fatalf("Delete of absent id should be a no-op: %v", err)
	}
}

func TestBulkPut(t *testing.T) {
	store := openTestStore(t)
	records := fmt.Sprintf("[%s,%s,%s]", task("a", "a"), task("b", "b"), task("c", "c"))
	if err := store.BulkPut("tasks", records); err != nil {
		t.Fatalf("BulkPut: %v", err)
	}
	expectIDs(t, store, "tasks", "a", "b", "c")
	if err := store.BulkPut("tasks", "[]"); err != nil {
		t.Fatalf("BulkPut empty: %v", err)
	}
}

func TestMutateAppliesBatchAtomically(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("t1", "one")); err != nil {
		t.Fatal(err)
	}
	ops := fmt.Sprintf(`[
		{"kind":"put","collection":"tasks","record":%s},
		{"kind":"delete","collection":"tasks","id":"t1"},
		{"kind":"saveMeta","meta":{"databaseId":"db-1","changesSinceBackup":7}},
		{"kind":"saveSettings","settings":{"theme":"dark"}}
	]`, task("t2", "two"))
	if err := store.Mutate(ops); err != nil {
		t.Fatalf("Mutate: %v", err)
	}
	expectIDs(t, store, "tasks", "t2")
	if meta, _ := store.GetMeta(); meta != `{"databaseId":"db-1","changesSinceBackup":7}` {
		t.Fatalf("meta = %q", meta)
	}
	if settings, _ := store.GetSettings(); settings != `{"theme":"dark"}` {
		t.Fatalf("settings = %q", settings)
	}
	if err := store.Mutate("[]"); err != nil {
		t.Fatalf("empty batch should be a no-op: %v", err)
	}
}

func TestMutateRejectsWholeBatchOnInvalidOp(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("t1", "one")); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveMeta(`{"databaseId":"db-1","changesSinceBackup":0}`); err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"unknown collection": fmt.Sprintf(
			`[{"kind":"put","collection":"tasks","record":%s},{"kind":"put","collection":"nope","record":%s}]`,
			task("t2", "two"), task("t3", "three")),
		"unknown kind": `[{"kind":"delete","collection":"tasks","id":"t1"},{"kind":"explode"}]`,
		"record without id": fmt.Sprintf(
			`[{"kind":"put","collection":"tasks","record":%s},{"kind":"put","collection":"tasks","record":{"title":"no id"}}]`,
			task("t2", "two")),
	}
	for name, ops := range cases {
		if err := store.Mutate(ops); err == nil {
			t.Fatalf("%s: Mutate should fail", name)
		}
		// Nothing from the batch applied.
		expectIDs(t, store, "tasks", "t1")
		if meta, _ := store.GetMeta(); meta != `{"databaseId":"db-1","changesSinceBackup":0}` {
			t.Fatalf("%s: meta changed to %q", name, meta)
		}
	}
}

func TestExportSnapshotShape(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("t1", "one")); err != nil {
		t.Fatal(err)
	}
	raw, err := store.ExportSnapshot()
	if err != nil {
		t.Fatalf("ExportSnapshot: %v", err)
	}
	var snapshot struct {
		Collections map[string][]json.RawMessage `json:"collections"`
		Settings    json.RawMessage              `json:"settings"`
		Meta        json.RawMessage              `json:"meta"`
	}
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		t.Fatalf("snapshot is not valid JSON: %v", err)
	}
	if len(snapshot.Collections) != len(collectionNames) {
		t.Fatalf("snapshot has %d collections, want %d", len(snapshot.Collections), len(collectionNames))
	}
	for _, name := range collectionNames {
		if _, ok := snapshot.Collections[name]; !ok {
			t.Fatalf("snapshot missing collection %q", name)
		}
	}
	if len(snapshot.Collections["tasks"]) != 1 {
		t.Fatalf("tasks = %v", snapshot.Collections["tasks"])
	}
	if string(snapshot.Settings) != "null" || string(snapshot.Meta) != "null" {
		t.Fatalf("unset settings/meta should be null, got %s / %s", snapshot.Settings, snapshot.Meta)
	}
}

func TestReplaceAll(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("old", "old")); err != nil {
		t.Fatal(err)
	}
	snapshot := fmt.Sprintf(
		`{"collections":{"tasks":[%s,%s],"employees":[]},"settings":{"theme":"dark"},"meta":{"databaseId":"db-2","changesSinceBackup":0}}`,
		task("n1", "one"), task("n2", "two"))
	if err := store.ReplaceAll(snapshot); err != nil {
		t.Fatalf("ReplaceAll: %v", err)
	}
	expectIDs(t, store, "tasks", "n1", "n2")
	expectIDs(t, store, "employees")
	if settings, _ := store.GetSettings(); settings != `{"theme":"dark"}` {
		t.Fatalf("settings = %q", settings)
	}
	if meta, _ := store.GetMeta(); meta != `{"databaseId":"db-2","changesSinceBackup":0}` {
		t.Fatalf("meta = %q", meta)
	}

	if err := store.ReplaceAll(`{"collections":{"bogus":[]},"settings":null,"meta":{"databaseId":"x"}}`); err == nil {
		t.Fatal("ReplaceAll with unknown collection should fail")
	}
	if err := store.ReplaceAll(`{"collections":{},"settings":null,"meta":null}`); err == nil {
		t.Fatal("ReplaceAll without meta should fail")
	}
}

func TestClearAll(t *testing.T) {
	store := openTestStore(t)
	if err := store.Put("tasks", task("t1", "one")); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveSettings(`{"theme":"dark"}`); err != nil {
		t.Fatal(err)
	}
	newMeta := `{"databaseId":"fresh","changesSinceBackup":0}`
	if err := store.ClearAll(newMeta); err != nil {
		t.Fatalf("ClearAll: %v", err)
	}
	expectIDs(t, store, "tasks")
	if settings, _ := store.GetSettings(); settings != "" {
		t.Fatalf("settings should be unset after ClearAll, got %q", settings)
	}
	if meta, _ := store.GetMeta(); meta != newMeta {
		t.Fatalf("meta = %q, want %q", meta, newMeta)
	}
}

func TestVerbatimJSONFidelity(t *testing.T) {
	store := openTestStore(t)
	record := `{"id":"r1","title":"Übung ✓","note":null,"nested":{"tags":["a",null,{"x":1.5}]},"emptyArr":[]}`
	if err := store.Put("employeeNotes", record); err != nil {
		t.Fatalf("Put: %v", err)
	}
	raw, err := store.GetAll("employeeNotes")
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if raw != "["+record+"]" {
		t.Fatalf("record not returned verbatim:\n got %s\nwant [%s]", raw, record)
	}
}

func TestUnknownCollectionRejectedEverywhere(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.GetAll("nope"); err == nil {
		t.Fatal("GetAll should reject unknown collection")
	}
	if err := store.Put("nope", task("t", "t")); err == nil {
		t.Fatal("Put should reject unknown collection")
	}
	if err := store.BulkPut("nope", "[]"); err == nil {
		t.Fatal("BulkPut should reject unknown collection")
	}
	if err := store.Delete("nope", "id"); err == nil {
		t.Fatal("Delete should reject unknown collection")
	}
}

func TestDatabaseInfoAndWALMode(t *testing.T) {
	store := openTestStore(t)
	raw, err := store.GetDatabaseInfo()
	if err != nil {
		t.Fatalf("GetDatabaseInfo: %v", err)
	}
	var info struct {
		Path        string `json:"path"`
		SizeBytes   int64  `json:"sizeBytes"`
		JournalMode string `json:"journalMode"`
	}
	if err := json.Unmarshal([]byte(raw), &info); err != nil {
		t.Fatalf("info is not valid JSON: %v", err)
	}
	if info.JournalMode != "wal" {
		t.Fatalf("journal mode = %q, want wal", info.JournalMode)
	}
	if info.Path == "" || info.SizeBytes <= 0 {
		t.Fatalf("unexpected info: %+v", info)
	}
}

// TestCollectionNamesMatchTypeScript guards against drift between the Go
// allowlist and COLLECTION_NAMES in src/data/DataStore.ts.
func TestCollectionNamesMatchTypeScript(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "src", "data", "DataStore.ts"))
	if err != nil {
		t.Fatalf("read DataStore.ts: %v", err)
	}
	arrayMatch := regexp.MustCompile(`(?s)COLLECTION_NAMES:\s*CollectionName\[\]\s*=\s*\[(.*?)\]`).
		FindSubmatch(source)
	if arrayMatch == nil {
		t.Fatal("could not locate COLLECTION_NAMES array in DataStore.ts")
	}
	var tsNames []string
	for _, m := range regexp.MustCompile(`"([A-Za-z]+)"`).FindAllSubmatch(arrayMatch[1], -1) {
		tsNames = append(tsNames, string(m[1]))
	}
	if len(tsNames) == 0 {
		t.Fatal("no collection names extracted from DataStore.ts")
	}
	goSorted := append([]string(nil), collectionNames...)
	tsSorted := append([]string(nil), tsNames...)
	sort.Strings(goSorted)
	sort.Strings(tsSorted)
	if len(goSorted) != len(tsSorted) {
		t.Fatalf("Go has %d collections, TypeScript has %d:\n go: %v\n ts: %v",
			len(goSorted), len(tsSorted), goSorted, tsSorted)
	}
	for i := range goSorted {
		if goSorted[i] != tsSorted[i] {
			t.Fatalf("collection lists differ:\n go: %v\n ts: %v", goSorted, tsSorted)
		}
	}
}

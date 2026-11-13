package main

import (
	"os"
	"path/filepath"
	"testing"
)

func backupName(fragment, date string) string {
	return "RADAR_AutoBackup_" + fragment + "_" + date + ".json"
}

func listNames(t *testing.T, folder string) []string {
	t.Helper()
	entries, err := os.ReadDir(folder)
	if err != nil {
		t.Fatalf("read folder: %v", err)
	}
	var names []string
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

func TestWriteAutoBackupCreatesFolderAndFile(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "nested", "backups")
	name := backupName("abc123", "2026-07-20")
	created, err := writeAutoBackup(folder, name, `{"format":"x"}`, 14)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if !created {
		t.Fatal("first write of the day should report created")
	}
	raw, err := os.ReadFile(filepath.Join(folder, name))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(raw) != `{"format":"x"}` {
		t.Fatalf("content = %q", raw)
	}
}

func TestWriteAutoBackupReplacesSameDayWithoutLeavingTemp(t *testing.T) {
	folder := t.TempDir()
	name := backupName("abc123", "2026-07-20")
	if _, err := writeAutoBackup(folder, name, "first", 14); err != nil {
		t.Fatalf("first write: %v", err)
	}
	created, err := writeAutoBackup(folder, name, "second", 14)
	if err != nil {
		t.Fatalf("second write: %v", err)
	}
	if created {
		t.Fatal("replacing the day's file must not report created")
	}
	raw, _ := os.ReadFile(filepath.Join(folder, name))
	if string(raw) != "second" {
		t.Fatalf("content = %q, want the later save", raw)
	}
	if names := listNames(t, folder); len(names) != 1 {
		t.Fatalf("folder holds %v, want only the day's file", names)
	}
}

func TestWriteAutoBackupPrunesOnlyThisDatabasesOldFiles(t *testing.T) {
	folder := t.TempDir()
	for _, date := range []string{"2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"} {
		if _, err := writeAutoBackup(folder, backupName("abc123", date), "x", 365); err != nil {
			t.Fatalf("seed %s: %v", date, err)
		}
	}
	// Another database's backups and an unrelated file share the folder.
	other := backupName("zzz999", "2026-01-01")
	if err := os.WriteFile(filepath.Join(folder, other), []byte("other"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "notes.txt"), []byte("keep me"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := writeAutoBackup(folder, backupName("abc123", "2026-07-19"), "x", 3); err != nil {
		t.Fatalf("write: %v", err)
	}

	mine, err := autoBackupFiles(folder, "abc123")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{backupName("abc123", "2026-07-19"), backupName("abc123", "2026-07-18"), backupName("abc123", "2026-07-17")}
	if len(mine) != len(want) {
		t.Fatalf("kept %v, want %v", mine, want)
	}
	for i := range want {
		if mine[i] != want[i] {
			t.Fatalf("kept %v, want %v (newest first)", mine, want)
		}
	}
	for _, survivor := range []string{other, "notes.txt"} {
		if _, err := os.Stat(filepath.Join(folder, survivor)); err != nil {
			t.Fatalf("%s must not be pruned: %v", survivor, err)
		}
	}
}

func TestWriteAutoBackupRejectsUnsafeNamesAndEmptyContent(t *testing.T) {
	folder := t.TempDir()
	for _, name := range []string{
		"",
		"backup.json",
		"../RADAR_AutoBackup_abc_2026-07-20.json",
		`..\RADAR_AutoBackup_abc_2026-07-20.json`,
		"RADAR_AutoBackup_abc_2026-07-20.json.exe",
		"RADAR_AutoBackup_a/b_2026-07-20.json",
		"RADAR_AutoBackup__2026-07-20.json",
		"RADAR_AutoBackup_abc_2026-7-20.json",
		"C:\\Windows\\RADAR_AutoBackup_abc_2026-07-20.json",
	} {
		if _, err := writeAutoBackup(folder, name, "x", 14); err == nil {
			t.Fatalf("name %q should be rejected", name)
		}
	}
	if _, err := writeAutoBackup(folder, backupName("abc", "2026-07-20"), "   ", 14); err == nil {
		t.Fatal("empty content should be rejected")
	}
	if _, err := writeAutoBackup("relative/folder", backupName("abc", "2026-07-20"), "x", 14); err == nil {
		t.Fatal("a relative folder should be rejected")
	}
	if names := listNames(t, folder); len(names) != 0 {
		t.Fatalf("rejected writes left files behind: %v", names)
	}
}

func TestClampAutoBackupKeep(t *testing.T) {
	for input, want := range map[int]int{-5: 1, 0: 1, 1: 1, 14: 14, 365: 365, 9999: 365} {
		if got := clampAutoBackupKeep(input); got != want {
			t.Fatalf("clamp(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestAutoBackupInfoReportsNewestAcrossDatabases(t *testing.T) {
	folder := t.TempDir()
	empty, err := autoBackupInfo(filepath.Join(folder, "missing"), true)
	if err != nil {
		t.Fatalf("a missing folder is not an error: %v", err)
	}
	if empty.Count != 0 || empty.LatestName != "" || !empty.IsDefault {
		t.Fatalf("empty info = %+v", empty)
	}
	writeAutoBackup(folder, backupName("abc123", "2026-07-18"), "x", 14)
	writeAutoBackup(folder, backupName("zz", "2026-07-20"), "x", 14)
	info, err := autoBackupInfo(folder, false)
	if err != nil {
		t.Fatal(err)
	}
	if info.Count != 2 || info.LatestName != backupName("zz", "2026-07-20") || info.LatestModified == "" || info.IsDefault {
		t.Fatalf("info = %+v", info)
	}
}

func TestBackupFolderPreferenceRoundTripAndFallback(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	if got := readSelectedBackupFolder(); got != "" {
		t.Fatalf("no preference yet, got %q", got)
	}
	chosen := filepath.Join(t.TempDir(), "my backups")
	if err := saveSelectedBackupFolder(chosen); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got := readSelectedBackupFolder(); got != filepath.Clean(chosen) {
		t.Fatalf("read back %q, want %q", got, chosen)
	}
	if err := saveSelectedBackupFolder("relative"); err == nil {
		t.Fatal("a relative folder must be rejected")
	}
	if err := saveSelectedBackupFolder(""); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got := readSelectedBackupFolder(); got != "" {
		t.Fatalf("cleared preference still reads %q", got)
	}
	// A damaged preference file falls back to "not chosen" rather than failing.
	path, _ := autoBackupLocationFile()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := readSelectedBackupFolder(); got != "" {
		t.Fatalf("damaged preference should read as unset, got %q", got)
	}
}

func TestDefaultAutoBackupFolderSitsBesideTheDatabase(t *testing.T) {
	db := filepath.Join("C:\\", "data", "radar.db")
	if got, want := defaultAutoBackupFolder(db), filepath.Join("C:\\", "data", "backups"); got != want {
		t.Fatalf("default folder = %q, want %q", got, want)
	}
}

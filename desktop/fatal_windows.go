//go:build windows

package main

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// fatal reports a startup failure before any Wails window exists, so it uses
// a bare Win32 message box rather than the Wails runtime dialogs.
func fatal(message string) {
	fmt.Fprintln(os.Stderr, message)
	title, _ := windows.UTF16PtrFromString("RADAR")
	text, _ := windows.UTF16PtrFromString(message)
	windows.MessageBox(0, text, title, windows.MB_OK|windows.MB_ICONERROR)
	os.Exit(1)
}

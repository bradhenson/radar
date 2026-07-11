//go:build !windows

package main

import (
	"fmt"
	"os"
)

func fatal(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}

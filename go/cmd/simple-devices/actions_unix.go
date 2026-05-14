//go:build !windows

package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

func suspend() error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("systemctl", "suspend").Run()
	case "darwin":
		return exec.Command("osascript", "-e", `tell app "System Events" to sleep`).Run()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

func shutdown() error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("shutdown", "-h", "now").Run()
	case "darwin":
		return exec.Command("shutdown", "-h", "now").Run()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

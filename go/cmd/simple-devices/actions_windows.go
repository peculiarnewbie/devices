//go:build windows

package main

import "os/exec"

func suspend() error {
	return exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0", "1", "0").Run()
}

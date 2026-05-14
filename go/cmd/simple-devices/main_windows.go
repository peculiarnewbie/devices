//go:build windows

package main

import (
	"log"

	"golang.org/x/sys/windows/svc"
)

func tryRunAsService() bool {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Printf("svc.IsWindowsService failed: %v", err)
		return false
	}
	if isService {
		svc.Run("SimpleDevicesAgent", &agentService{})
		return true
	}
	return false
}

type agentService struct{}

func (s *agentService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown
	changes <- svc.Status{State: svc.StartPending}

	errCh := make(chan error, 1)
	go func() {
		errCh <- runAgent()
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	select {
	case c := <-r:
		switch c.Cmd {
		case svc.Interrogate:
			changes <- c.CurrentStatus
		case svc.Stop, svc.Shutdown:
			changes <- svc.Status{State: svc.StopPending}
		}
	case err := <-errCh:
		log.Printf("server error: %v", err)
	}

	return false, 0
}

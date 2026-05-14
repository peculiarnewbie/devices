package main

import (
	"flag"
	"log"
	"time"
)

var hubURL = flag.String("hub", "", "wss:// url of the Durable Object (runs hub mode)")

func main() {
	flag.Parse()

	if tryRunAsService() {
		return
	}

	if *hubURL != "" {
		runHubMode(*hubURL)
	} else {
		runAgentMode()
	}
}

func runHubMode(url string) {
	log.Printf("hub mode, url=%s", url)
	for {
		if err := runHub(url); err != nil {
			log.Printf("hub error: %v, reconnecting in 5s", err)
			time.Sleep(5 * time.Second)
		}
	}
}

func runAgentMode() {
	log.Printf("agent mode")
	log.Fatal(runAgent())
}

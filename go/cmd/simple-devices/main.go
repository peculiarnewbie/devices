package main

import (
	"flag"
	"log"
	"os"
	"time"
)

var hubURL = flag.String("hub", "", "wss:// url of the Durable Object (runs hub mode)")
var hubSecret = flag.String("secret", "", "X-Hub-Secret for hub auth")

func hubSecretValue() string {
	if *hubSecret != "" {
		return *hubSecret
	}
	return os.Getenv("HUB_SECRET")
}

func main() {
	flag.Parse()

	if tryRunAsService() {
		return
	}

	startCPUSampler()

	if *hubURL != "" {
		runHubMode(*hubURL)
	} else {
		runAgentMode()
	}
}

func runHubMode(url string) {
	log.Printf("hub mode, url=%s", url)
	for {
		if err := runHub(url, hubSecretValue()); err != nil {
			log.Printf("hub error: %v, reconnecting in 5s", err)
			time.Sleep(5 * time.Second)
		}
	}
}

func runAgentMode() {
	log.Printf("agent mode")
	log.Fatal(runAgent())
}

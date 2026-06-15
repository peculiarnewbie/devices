package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

func runAgent() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/status", handleStatus)
	mux.HandleFunc("/sleep", handleSleep)
	mux.HandleFunc("/wake", handleWake)

	log.Printf("agent listening on :9099")
	return http.ListenAndServe(":9099", mux)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	status := collectStatus()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func handleSleep(w http.ResponseWriter, r *http.Request) {
	log.Println("sleep requested")
	go func() {
		time.Sleep(200 * time.Millisecond)
		if err := suspend(); err != nil {
			log.Printf("sleep failed: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"action": "sleep", "status": "ok"})
}

func handleWake(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MAC string `json:"mac"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.MAC == "" {
		http.Error(w, "missing mac field", http.StatusBadRequest)
		return
	}

	log.Printf("sending magic packet to %s", body.MAC)
	if err := sendWoL(body.MAC); err != nil {
		http.Error(w, fmt.Sprintf("wol failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"action": "wake", "mac": body.MAC, "status": "ok"})
}

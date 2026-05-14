package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os/exec"
)

func getTailscalePeers() ([]TailscalePeer, error) {
	cmd := exec.Command("tailscale", "status", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("tailscale status failed: %w", err)
	}

	var status TailscaleStatus
	if err := json.Unmarshal(out, &status); err != nil {
		return nil, fmt.Errorf("parse tailscale status: %w", err)
	}

	peers := make([]TailscalePeer, 0, len(status.Peer)+1)
	for _, peer := range status.Peer {
		peer.TailAddr = firstTailscaleIP(peer)
		if peer.TailAddr == "" {
			log.Printf("tailscale: skipping %s, no tailscale IP", peer.HostName)
			continue
		}
		peers = append(peers, peer)
	}
	status.Self.TailAddr = "127.0.0.1"
	peers = append(peers, status.Self)

	online := 0
	for _, p := range peers {
		if p.Online {
			online++
		}
	}
	log.Printf("tailscale: %d peers (%d online)", len(status.Peer), online)

	return peers, nil
}

func firstTailscaleIP(peer TailscalePeer) string {
	if peer.TailAddr != "" {
		return peer.TailAddr
	}
	for _, ip := range peer.TailscaleIPs {
		parsed := net.ParseIP(ip)
		if parsed != nil && parsed.To4() != nil {
			return parsed.String()
		}
	}
	return ""
}

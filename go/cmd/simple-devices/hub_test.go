package main

import "testing"

func TestFirstTailscaleIPUsesIPv4FromTailscaleIPs(t *testing.T) {
	peer := TailscalePeer{
		TailscaleIPs: []string{"fd7a:115c:a1e0::1", "100.96.12.34"},
	}

	got := firstTailscaleIP(peer)
	if got != "100.96.12.34" {
		t.Fatalf("firstTailscaleIP() = %q, want %q", got, "100.96.12.34")
	}
}

func TestFirstTailscaleIPKeepsLegacyTailAddr(t *testing.T) {
	peer := TailscalePeer{
		TailAddr:     "100.64.1.2",
		TailscaleIPs: []string{"100.96.12.34"},
	}

	got := firstTailscaleIP(peer)
	if got != "100.64.1.2" {
		t.Fatalf("firstTailscaleIP() = %q, want %q", got, "100.64.1.2")
	}
}

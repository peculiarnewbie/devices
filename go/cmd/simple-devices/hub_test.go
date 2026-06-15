package main

import (
	"encoding/json"
	"testing"
)

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

func TestOfflineDeviceJSONHasNoNullArrays(t *testing.T) {
	d := DeviceState{
		Hostname:    "test-device",
		TailscaleIP: "100.1.2.3",
		OS:          "linux",
		Macs:        []string{},
		Online:      false,
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if string(raw["macs"]) == "null" {
		t.Errorf("macs marshaled to null, expected []")
	}

	// Verify the DO schema can parse this
	var parsed DeviceState
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("round-trip unmarshal failed: %v", err)
	}
	if parsed.Macs == nil {
		t.Errorf("round-trip macs is nil")
	}
}

func TestNilSlicesMarshalToNull(t *testing.T) {
	d := DeviceState{
		Hostname: "test",
		Online:   false,
		// Macs is nil (zero value)
	}

	data, err := json.Marshal(d)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var raw map[string]json.RawMessage
	json.Unmarshal(data, &raw)

	// This documents the bug: nil slices become null
	if string(raw["macs"]) != "null" {
		t.Errorf("expected nil macs to marshal to null, got %s", string(raw["macs"]))
	}
}

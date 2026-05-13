package wol

import (
	"encoding/hex"
	"fmt"
	"net"
	"strings"
)

func BuildPacket(mac string) ([]byte, error) {
	cleaned := strings.ReplaceAll(strings.ReplaceAll(mac, ":", ""), "-", "")
	macBytes, err := hex.DecodeString(cleaned)
	if err != nil || len(macBytes) != 6 {
		return nil, fmt.Errorf("invalid mac address: %s", mac)
	}

	packet := make([]byte, 102)
	for i := 0; i < 6; i++ {
		packet[i] = 0xFF
	}
	for i := 1; i <= 16; i++ {
		copy(packet[i*6:(i+1)*6], macBytes)
	}

	return packet, nil
}

func Send(mac string) error {
	packet, err := BuildPacket(mac)
	if err != nil {
		return err
	}

	addr := &net.UDPAddr{
		IP:   net.IPv4bcast,
		Port: 9,
	}
	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		return fmt.Errorf("failed to dial udp: %w", err)
	}
	defer conn.Close()

	_, err = conn.Write(packet)
	return err
}

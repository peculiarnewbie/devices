package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/coder/websocket"
)

type DeviceState struct {
	Hostname    string `json:"hostname"`
	TailscaleIP string `json:"tailscale_ip"`
	OS          string `json:"os"`
	Macs        []string `json:"macs"`
	Interfaces  []struct {
		Name  string   `json:"name"`
		MAC   string   `json:"mac"`
		Addrs []string `json:"addrs"`
	} `json:"interfaces"`
	Subnet     string  `json:"subnet"`
	Uptime     uint64  `json:"uptime"`
	CPUPercent float64 `json:"cpu_percent"`
	Memory     struct {
		UsedGB  float64 `json:"used_gb"`
		TotalGB float64 `json:"total_gb"`
	} `json:"memory"`
	Disk struct {
		UsedGB  float64 `json:"used_gb"`
		TotalGB float64 `json:"total_gb"`
	} `json:"disk"`
	Online   bool  `json:"online"`
	LastSeen int64 `json:"last_seen"`
}

type WSMessage struct {
	Type    string        `json:"type"`
	Role    string        `json:"role,omitempty"`
	Devices []DeviceState `json:"devices,omitempty"`
	Device  string        `json:"device,omitempty"`
	Action  string        `json:"action,omitempty"`
	MAC     string        `json:"mac,omitempty"`
	Subnet  string        `json:"subnet,omitempty"`
	OK      bool          `json:"ok,omitempty"`
	Message string        `json:"message,omitempty"`
}

type TailscalePeer struct {
	HostName    string   `json:"HostName"`
	DNSName     string   `json:"DNSName"`
	TailAddr    string   `json:"TailAddr"`
	TailscaleIPs []string `json:"TailscaleIPs"`
	Online      bool     `json:"Online"`
	OS          string   `json:"OS"`
}

type TailscaleStatus struct {
	Peer map[string]TailscalePeer `json:"Peer"`
	Self TailscalePeer            `json:"Self"`
}

const (
	leafPort    = "9099"
	pollTimeout = 4 * time.Second
)

var doURL = flag.String("do", "", "wss:// url of the Durable Object (required)")

func main() {
	flag.Parse()
	if *doURL == "" {
		log.Fatal("-do flag is required (e.g. wss://simple-devices.<name>.workers.dev/ws)")
	}

	log.Printf("hub starting, do=%s", *doURL)

	for {
		if err := connectAndServe(*doURL); err != nil {
			log.Printf("websocket error: %v, reconnecting in 5s", err)
			time.Sleep(5 * time.Second)
		}
	}
}

func connectAndServe(url string) error {
	ctx := context.Background()

	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close(websocket.StatusInternalError, "hub shutting down")

	log.Printf("connected to DO")

	if err := wsjsonWrite(ctx, conn, WSMessage{Type: "register", Role: "hub"}); err != nil {
		return fmt.Errorf("register: %w", err)
	}

	for {
		msg, err := wsjsonRead(ctx, conn)
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}

		switch msg.Type {
		case "refresh":
			devices := pollAllDevices(ctx)
			if err := wsjsonWrite(ctx, conn, WSMessage{
				Type:    "update",
				Devices: devices,
			}); err != nil {
				return fmt.Errorf("write update: %w", err)
			}

		case "execute":
			result := executeCommand(msg)
			if err := wsjsonWrite(ctx, conn, result); err != nil {
				log.Printf("failed to send command_result: %v", err)
			}
		}
	}
}

func pollAllDevices(ctx context.Context) []DeviceState {
	peers, err := getTailscalePeers()
	if err != nil {
		log.Printf("failed to get tailscale peers: %v", err)
		return nil
	}

	log.Printf("polling %d devices", len(peers))

	results := make([]DeviceState, 0, len(peers))
	ch := make(chan DeviceState, len(peers))

	for _, peer := range peers {
		go func(p TailscalePeer) {
			ch <- pollDevice(p)
		}(peer)
	}

	for range peers {
		results = append(results, <-ch)
	}

	online := 0
	for _, d := range results {
		if d.Online {
			online++
		}
	}
	log.Printf("polling done: %d/%d online", online, len(results))

	return results
}

func pollDevice(peer TailscalePeer) DeviceState {
	d := DeviceState{
		Hostname:    peer.HostName,
		TailscaleIP: peer.TailAddr,
		OS:          peer.OS,
		Online:      false,
	}

	url := fmt.Sprintf("http://%s:%s/status", peer.TailAddr, leafPort)
	ctx, cancel := context.WithTimeout(context.Background(), pollTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return d
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("poll %s (%s) failed: %v", peer.HostName, peer.TailAddr, err)
		return d
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Printf("poll %s (%s) returned status=%d", peer.HostName, peer.TailAddr, resp.StatusCode)
		return d
	}

	var status DeviceState
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		log.Printf("poll %s (%s) decode failed: %v", peer.HostName, peer.TailAddr, err)
		return d
	}

	status.Online = true
	status.LastSeen = time.Now().UnixMilli()

	return status
}

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

func executeCommand(msg WSMessage) WSMessage {
	switch msg.Action {
	case "wake":
		return executeWake(msg)
	case "sleep", "shutdown":
		return executeDeviceAction(msg.Device, msg.Action)
	default:
		return WSMessage{Type: "command_result", Device: msg.Device, Action: msg.Action, OK: false, Message: fmt.Sprintf("unknown action: %s", msg.Action)}
	}
}

func executeWake(msg WSMessage) WSMessage {
	mac := msg.MAC
	if mac == "" {
		log.Printf("wol: no mac for %s", msg.Device)
		return WSMessage{Type: "command_result", Device: msg.Device, Action: "wake", OK: false, Message: fmt.Sprintf("no MAC address cached for %s", msg.Device)}
	}

	log.Printf("wol: waking %s (mac=%s subnet=%s)", msg.Device, mac, msg.Subnet)

	wolPeer := findWoLPeer(msg.Device, msg.Subnet)
	if wolPeer == "" {
		log.Printf("wol: failed — no relay peer for %s", msg.Device)
		return WSMessage{Type: "command_result", Device: msg.Device, Action: "wake", OK: false, Message: fmt.Sprintf("no online peer on same subnet as %s", msg.Device)}
	}

	url := fmt.Sprintf("http://%s:%s/wake", wolPeer, leafPort)
	body := fmt.Sprintf(`{"mac":"%s"}`, mac)

	ctx, cancel := context.WithTimeout(context.Background(), pollTimeout)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("wol: relay to %s failed: %v", wolPeer, err)
		return WSMessage{Type: "command_result", Device: msg.Device, Action: "wake", OK: false, Message: fmt.Sprintf("relay to %s failed: %v", wolPeer, err)}
	}
	defer resp.Body.Close()

	log.Printf("wol: sent via %s (status=%d)", wolPeer, resp.StatusCode)
	return WSMessage{Type: "command_result", Device: msg.Device, Action: "wake", OK: true, Message: fmt.Sprintf("magic packet sent via %s", wolPeer)}
}

func executeDeviceAction(hostname, action string) WSMessage {
	url := fmt.Sprintf("http://%s:%s/%s", hostname, leafPort, action)
	ctx, cancel := context.WithTimeout(context.Background(), pollTimeout)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, "POST", url, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("%s %s failed: %v", action, hostname, err)
		return WSMessage{Type: "command_result", Device: hostname, Action: action, OK: false, Message: fmt.Sprintf("%s failed: %v", action, err)}
	}
	defer resp.Body.Close()
	log.Printf("%s %s: status=%d", action, hostname, resp.StatusCode)
	return WSMessage{Type: "command_result", Device: hostname, Action: action, OK: true, Message: fmt.Sprintf("%s sent", action)}
}

func findWoLPeer(targetHostname, targetSubnet string) string {
	peers, err := getTailscalePeers()
	if err != nil {
		log.Printf("wol: failed to get tailscale peers: %v", err)
		return ""
	}

	if targetSubnet == "" {
		log.Printf("wol: no subnet for %s, cannot find relay", targetHostname)
		return ""
	}

	log.Printf("wol: searching relay for %s on subnet %s (%d peers)", targetHostname, targetSubnet, len(peers))

	type peerState struct {
		addr   string
		subnet string
	}

	deviceStates := make(map[string]peerState)

	for _, peer := range peers {
		if peer.HostName == targetHostname {
			continue
		}

		status := pollDevice(peer)
		if status.Online && status.Subnet != "" {
			deviceStates[peer.HostName] = peerState{
				addr:   peer.TailAddr,
				subnet: status.Subnet,
			}
		}
	}

	if len(deviceStates) == 0 {
		log.Printf("wol: no online peers found to relay for %s", targetHostname)
		return ""
	}

	log.Printf("wol: %d online peers checked, looking for subnet match", len(deviceStates))

	for hostname, ps := range deviceStates {
		if isSameSubnet(targetSubnet, ps.subnet) {
			log.Printf("wol: relay found: %s (%s)", hostname, ps.addr)
			return ps.addr
		}
	}

	log.Printf("wol: no relay found on subnet %s (checked %d peers)", targetSubnet, len(deviceStates))
	return ""
}

func isSameSubnet(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	_, anet, _ := netParseCIDR(a)
	_, bnet, _ := netParseCIDR(b)
	if anet == nil || bnet == nil {
		return false
	}
	return anet.IP.Equal(bnet.IP) && anet.Mask.String() == bnet.Mask.String()
}

func netParseCIDR(s string) (string, *net.IPNet, error) {
	ip, ipnet, err := net.ParseCIDR(s)
	if err != nil {
		return "", nil, err
	}
	return ip.String(), ipnet, nil
}

func wsjsonWrite(ctx context.Context, conn *websocket.Conn, msg WSMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}

func wsjsonRead(ctx context.Context, conn *websocket.Conn) (WSMessage, error) {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return WSMessage{}, err
	}
	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return WSMessage{}, err
	}
	return msg, nil
}

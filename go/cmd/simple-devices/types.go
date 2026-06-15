package main

type DeviceState struct {
	Hostname    string   `json:"hostname"`
	TailscaleIP string   `json:"tailscale_ip"`
	OS          string   `json:"os"`
	Macs        []string `json:"macs"`
	Subnet      string   `json:"subnet"`
	Uptime      uint64   `json:"uptime"`
	CPUPercent  float64  `json:"cpu_percent"`
	Memory      struct {
		UsedGB  float64 `json:"used_gb"`
		TotalGB float64 `json:"total_gb"`
	} `json:"memory"`
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
	HostName     string   `json:"HostName"`
	DNSName      string   `json:"DNSName"`
	TailAddr     string   `json:"TailAddr"`
	TailscaleIPs []string `json:"TailscaleIPs"`
	Online       bool     `json:"Online"`
	OS           string   `json:"OS"`
}

type TailscaleStatus struct {
	Peer map[string]TailscalePeer `json:"Peer"`
	Self TailscalePeer            `json:"Self"`
}

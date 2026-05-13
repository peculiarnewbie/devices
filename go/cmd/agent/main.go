package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"simple-devices/pkg/wol"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

type InterfaceInfo struct {
	Name  string   `json:"name"`
	MAC   string   `json:"mac"`
	Addrs []string `json:"addrs"`
}

type MemoryInfo struct {
	UsedGB  float64 `json:"used_gb"`
	TotalGB float64 `json:"total_gb"`
}

type DiskInfo struct {
	UsedGB  float64 `json:"used_gb"`
	TotalGB float64 `json:"total_gb"`
}

type StatusResponse struct {
	Hostname    string          `json:"hostname"`
	TailscaleIP string          `json:"tailscale_ip"`
	OS          string          `json:"os"`
	Macs        []string        `json:"macs"`
	Interfaces  []InterfaceInfo `json:"interfaces"`
	Subnet      string          `json:"subnet"`
	Uptime      uint64          `json:"uptime"`
	CPUPercent  float64         `json:"cpu_percent"`
	Memory      MemoryInfo      `json:"memory"`
	Disk        DiskInfo        `json:"disk"`
}

const port = "9099"

func run() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/status", handleStatus)
	mux.HandleFunc("/sleep", handleSleep)
	mux.HandleFunc("/shutdown", handleShutdown)
	mux.HandleFunc("/wake", handleWake)

	log.Printf("agent listening on :%s (os=%s arch=%s)", port, runtime.GOOS, runtime.GOARCH)
	return http.ListenAndServe(":"+port, mux)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := collectStatus()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

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

func handleShutdown(w http.ResponseWriter, r *http.Request) {
	log.Println("shutdown requested")
	go func() {
		time.Sleep(200 * time.Millisecond)
		if err := shutdown(); err != nil {
			log.Printf("shutdown failed: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"action": "shutdown", "status": "ok"})
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
	if err := wol.Send(body.MAC); err != nil {
		http.Error(w, fmt.Sprintf("wol failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"action": "wake", "mac": body.MAC, "status": "ok"})
}

func collectStatus() (*StatusResponse, error) {
	hostname, _ := os.Hostname()
	hinfo, err := host.Info()
	if err != nil {
		log.Printf("host.Info failed: %v", err)
	}
	vmem, err := mem.VirtualMemory()
	if err != nil {
		log.Printf("mem.VirtualMemory failed: %v", err)
	}
	diskinfo, err := disk.Usage("/")
	if err != nil {
		log.Printf("disk.Usage failed: %v", err)
	}
	cpuPercent, err := cpu.Percent(1*time.Second, false)
	if err != nil {
		log.Printf("cpu.Percent failed: %v", err)
	}

	var memoryUsedGB, memoryTotalGB float64
	if vmem != nil {
		memoryUsedGB = float64(vmem.Used) / (1024 * 1024 * 1024)
		memoryTotalGB = float64(vmem.Total) / (1024 * 1024 * 1024)
	}

	var diskUsedGB, diskTotalGB float64
	if diskinfo != nil {
		diskUsedGB = float64(diskinfo.Used) / (1024 * 1024 * 1024)
		diskTotalGB = float64(diskinfo.Total) / (1024 * 1024 * 1024)
	}

	var cpuPct float64
	if len(cpuPercent) > 0 {
		cpuPct = cpuPercent[0]
	}

	tailscaleIP, subnet, ifaces := collectNetInfo()

	macs := make([]string, 0)
	for _, iface := range ifaces {
		if iface.MAC != "" {
			macs = append(macs, iface.MAC)
		}
	}

	status := &StatusResponse{
		Hostname:    hostname,
		TailscaleIP: tailscaleIP,
		OS:          runtime.GOOS,
		Macs:        macs,
		Interfaces:  ifaces,
		Subnet:      subnet,
		Uptime:      hinfo.Uptime,
		CPUPercent:  cpuPct,
		Memory: MemoryInfo{
			UsedGB:  memoryUsedGB,
			TotalGB: memoryTotalGB,
		},
		Disk: DiskInfo{
			UsedGB:  diskUsedGB,
			TotalGB: diskTotalGB,
		},
	}

	return status, nil
}

func collectNetInfo() (tailscaleIP string, subnet string, ifaces []InterfaceInfo) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return
	}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, _ := iface.Addrs()

		addrsStr := make([]string, 0)
		for _, addr := range addrs {
			ipAddr := strings.Split(addr.String(), "/")[0]
			addrsStr = append(addrsStr, ipAddr)

			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}

			if isTailscaleIP(ipnet.IP) && tailscaleIP == "" {
				tailscaleIP = ipnet.IP.String()
			}

			if !isTailscaleIP(ipnet.IP) && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
				if subnet == "" {
					size, _ := ipnet.Mask.Size()
					masked := ipnet.IP.Mask(ipnet.Mask)
					subnet = fmt.Sprintf("%s/%d", masked.String(), size)
				}
			}
		}

		mac := iface.HardwareAddr.String()
		if mac != "" {
			ifaces = append(ifaces, InterfaceInfo{
				Name:  iface.Name,
				MAC:   mac,
				Addrs: addrsStr,
			})
		}
	}

	return
}

func isTailscaleIP(ip net.IP) bool {
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	return ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127
}

func suspend() error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("systemctl", "suspend").Run()
	case "darwin":
		return exec.Command("osascript", "-e", `tell app "System Events" to sleep`).Run()
	case "windows":
		return exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0", "1", "0").Run()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

func shutdown() error {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("shutdown", "-h", "now").Run()
	case "darwin":
		return exec.Command("shutdown", "-h", "now").Run()
	case "windows":
		return exec.Command("shutdown", "/s", "/t", "0").Run()
	default:
		return fmt.Errorf("unsupported os: %s", runtime.GOOS)
	}
}

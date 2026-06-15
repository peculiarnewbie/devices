package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

var (
	cpuMu           sync.RWMutex
	cachedCPUPercent float64
	cpuSamplerOnce  sync.Once
)

func startCPUSampler() {
	cpuSamplerOnce.Do(func() {
		// Initialize the baseline so the first real sample is meaningful.
		_, _ = cpu.Percent(0, false)

		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for range ticker.C {
				pct, err := cpu.Percent(0, false)
				if err != nil {
					log.Printf("cpu.Percent failed: %v", err)
					continue
				}
				if len(pct) > 0 {
					cpuMu.Lock()
					cachedCPUPercent = pct[0]
					cpuMu.Unlock()
				}
			}
		}()
	})
}

func getCPUPercent() float64 {
	cpuMu.RLock()
	defer cpuMu.RUnlock()
	return cachedCPUPercent
}

func collectStatus() *DeviceState {
	hostname, _ := os.Hostname()
	hinfo, err := host.Info()
	if err != nil {
		log.Printf("host.Info failed: %v", err)
	}
	vmem, err := mem.VirtualMemory()
	if err != nil {
		log.Printf("mem.VirtualMemory failed: %v", err)
	}

	var memoryUsedGB, memoryTotalGB float64
	if vmem != nil {
		memoryUsedGB = float64(vmem.Used) / (1024 * 1024 * 1024)
		memoryTotalGB = float64(vmem.Total) / (1024 * 1024 * 1024)
	}

	tailscaleIP, subnet, macs := collectNetInfo()

	return &DeviceState{
		Hostname:    hostname,
		TailscaleIP: tailscaleIP,
		OS:          runtime.GOOS,
		Macs:        macs,
		Subnet:      subnet,
		Uptime:      hinfo.Uptime,
		CPUPercent:  getCPUPercent(),
		Memory: struct {
			UsedGB  float64 `json:"used_gb"`
			TotalGB float64 `json:"total_gb"`
		}{
			UsedGB:  memoryUsedGB,
			TotalGB: memoryTotalGB,
		},
		Online:   true,
		LastSeen: time.Now().UnixMilli(),
	}
}

func collectNetInfo() (tailscaleIP string, subnet string, macs []string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return
	}

	seenMACs := make(map[string]bool)
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
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
		if mac != "" && !seenMACs[mac] {
			seenMACs[mac] = true
			macs = append(macs, mac)
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

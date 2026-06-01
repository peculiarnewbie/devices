package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"runtime"
	"strings"
	"time"

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

	interfaces := make([]struct {
		Name  string   `json:"name"`
		MAC   string   `json:"mac"`
		Addrs []string `json:"addrs"`
	}, len(ifaces))
	for i, iface := range ifaces {
		interfaces[i].Name = iface.Name
		interfaces[i].MAC = iface.MAC
		interfaces[i].Addrs = iface.Addrs
	}

	return &DeviceState{
		Hostname:    hostname,
		TailscaleIP: tailscaleIP,
		OS:          runtime.GOOS,
		Macs:        macs,
		Interfaces:  interfaces,
		Subnet:      subnet,
		Uptime:      hinfo.Uptime,
		CPUPercent:  cpuPct,
		Memory: struct {
			UsedGB  float64 `json:"used_gb"`
			TotalGB float64 `json:"total_gb"`
		}{
			UsedGB:  memoryUsedGB,
			TotalGB: memoryTotalGB,
		},
		Disk: struct {
			UsedGB  float64 `json:"used_gb"`
			TotalGB float64 `json:"total_gb"`
		}{
			UsedGB:  diskUsedGB,
			TotalGB: diskTotalGB,
		},
		Online:   true,
		LastSeen: time.Now().UnixMilli(),
	}
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

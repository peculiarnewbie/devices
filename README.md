# simple-devices

Self-hosted device monitoring and remote power management for your [Tailscale](https://tailscale.com) tailnet. View online/offline status, CPU, RAM, and uptime of every device, and remotely wake or sleep any device from a web UI.

**Live:** [devices.peculiarnewbie.com](https://devices.peculiarnewbie.com)

## Architecture

```
Browser UI  ←─ws─→  Cloudflare DO (DeviceDO)  ←─ws─→  Hub Agent (Go)
                                                        │
                                                   Tailscale mesh
                                                        │
                                                  Leaf Agents (Go, :9099)
```

- **Leaf Agent** — runs on every device. Lightweight HTTP server on port `9099` that serves local system metrics (`/status`) and handles power commands (`/sleep`, `/wake`).
- **Hub Agent** — runs on one device. Maintains a WebSocket to the Cloudflare Durable Object. When polled, it discovers all Tailscale peers and concurrently HTTP-polls each one's `:9099/status` endpoint.
- **Cloudflare Worker + Durable Object** — always-on cloud relay. Holds canonical device state, brokers WebSocket messages between hub and browser clients, handles auth (Google OAuth).
- **SolidJS Frontend** — single-page app served as a static asset by the Worker.

## Prerequisites

- [Go 1.24+](https://go.dev/dl/)
- [Tailscale](https://tailscale.com) installed on all devices
- [Node.js](https://nodejs.org) + [pnpm](https://pnpm.io) (for the frontend/worker)
- A Cloudflare account (for the Worker + Durable Object)
- [Alchemy](https://alchemy.run) (used for infrastructure-as-code deployment)

## Building the Go Binary

All Go code lives in the `go/` directory. The single binary operates in two modes:

- **Agent mode** (default) — HTTP server on `:9099`. Runs on every device.
- **Hub mode** (`-hub` flag) — WebSocket client that polls all tailnet peers. Runs on one device.

### Build for your current platform

```bash
cd go
go build -o simple-devices ./cmd/simple-devices
```

### Cross-compile

```bash
# Linux (amd64)
GOOS=linux GOARCH=amd64 go build -o simple-devices-linux-amd64 ./cmd/simple-devices

# Linux (arm64)
GOOS=linux GOARCH=arm64 go build -o simple-devices-linux-arm64 ./cmd/simple-devices

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o simple-devices-darwin-arm64 ./cmd/simple-devices

# Windows
GOOS=windows GOARCH=amd64 go build -o simple-devices.exe ./cmd/simple-devices
```

## Deploying the Cloudflare Worker

The Worker serves the frontend and hosts the Durable Object that brokers all communication.

```bash
# Install dependencies
pnpm install

# Deploy (builds frontend + deploys Worker via Alchemy)
pnpm run deploy
```

This requires a `HUB_SECRET` environment variable set in your shell or `.env` file. This secret authenticates the hub agent's WebSocket connection.

## Installing the Leaf Agent

The leaf agent runs on every device you want to monitor. It serves system metrics on `:9099` and accepts power commands.

### Linux (systemd)

1. Copy the binary to the target device:
   ```bash
   scp simple-devices user@device:~/.local/bin/
   ```

2. SSH into the device and run the installer:
   ```bash
   ./scripts/install-leaf-agent.sh
   ```

   This creates a systemd service (`simple-devices-agent`) that starts on boot.

3. Verify:
   ```bash
   systemctl status simple-devices-agent
   curl http://localhost:9099/status
   ```

### macOS (launchd)

1. Copy the binary:
   ```bash
   scp simple-devices user@device:~/.local/bin/
   ```

2. Run the installer:
   ```bash
   ./scripts/install-leaf-agent.sh.macos
   ```

   This creates a LaunchAgent (`com.simple-devices.agent`).

3. Verify:
   ```bash
   launchctl list | grep simple-devices
   curl http://localhost:9099/status
   ```

### Windows (Service)

1. Copy `simple-devices.exe` to `%USERPROFILE%\.local\bin\`.

2. Run PowerShell as Administrator:
   ```powershell
   .\scripts\install-leaf-agent.ps1
   ```

   This creates a Windows Service (`SimpleDevicesAgent`).

3. Verify:
   ```powershell
   Get-Service SimpleDevicesAgent
   curl http://localhost:9099/status
   ```

### Run manually (any platform)

```bash
# Agent mode (default — no flags needed)
./simple-devices
```

The agent listens on `:9099` and exposes:
- `GET /status` — full device state (CPU, RAM, uptime, network)
- `GET /health` — simple health check
- `POST /sleep` — suspend the device
- `POST /wake` — send a Wake-on-LAN magic packet (expects `{"mac":"..."}` body)

## Installing the Hub Agent

The hub runs on **one** device in your tailnet. It connects to the Cloudflare Durable Object via WebSocket and polls all peers on each refresh cycle.

### Linux (systemd)

1. Copy the binary to the hub device:
   ```bash
   scp simple-devices user@hub-device:~/.local/bin/
   ```

2. Set the hub URL and run the installer:
   ```bash
   SIMPLE_DEVICES_HUB=wss://simple-devices.your-subdomain.workers.dev/ws ./scripts/install-hub-agent.sh
   ```

3. Verify:
   ```bash
   systemctl status simple-devices-hub
   journalctl -u simple-devices-hub -f
   ```

### Run manually

```bash
./simple-devices -hub=wss://simple-devices.your-subdomain.workers.dev/ws
```

If your Worker requires a hub secret:

```bash
./simple-devices -hub=wss://... -secret=your-hub-secret
# or
HUB_SECRET=your-hub-secret ./simple-devices -hub=wss://...
```

The hub will reconnect automatically if the WebSocket drops (5-second backoff).

## How Device Status Works

1. The browser UI connects to the Durable Object via WebSocket and sends periodic `refresh` requests (default every 10s, configurable 5–60s).
2. The DO forwards the `refresh` to the hub.
3. The hub calls `tailscale status --json` to discover all peers, then concurrently polls `http://<tailscale-ip>:9099/status` for each (4-second timeout).
4. **Online:** If the HTTP request succeeds and decodes, the device is marked `Online: true`.
5. **Offline:** If the request fails (timeout, connection refused, non-200, decode error), the device is marked `Online: false`.
6. The hub sends the full device list back to the DO as an `update`.
7. The DO merges the data, persists it, and broadcasts to all connected UI clients.

## Troubleshooting

### Device shows offline but the agent is running

Check that the agent is reachable via its **Tailscale IP** (not just hostname):

```bash
# From the hub machine:
curl http://<tailscale-ip>:9099/status
```

Common causes:
- Agent not running on the target device
- Firewall blocking port 9099 on the Tailscale interface
- Agent bound to localhost only (should bind to `0.0.0.0:9099`)

### Check hub logs

```bash
# Linux
journalctl -u simple-devices-hub -f

# macOS
tail -f /tmp/simple-devices-agent.log

# Windows
Get-EventLog -LogName Application -Source "SimpleDevicesAgent" -Newest 20
```

The hub logs each poll cycle with per-device results:
```
polling 5 devices
  ✓ DESKTOP-WORK-ARIF (100.97.2.26) online
  ✓ LUNE-PC (100.66.165.30) online
  ✗ POCO M7 Pro 5G (100.106.235.94) offline
polling done: 3/5 online
```

### Hub not connecting to the DO

- Verify the `-hub` URL is correct (`wss://...`)
- Check that `HUB_SECRET` matches between the hub and the Worker's environment
- Ensure the Worker is deployed and the domain resolves

## Project Structure

```
go/
├── cmd/simple-devices/
│   ├── main.go            # Entry point: hub mode vs agent mode
│   ├── hub.go             # Hub: WebSocket to DO, polls all peers
│   ├── agent.go           # Agent: HTTP server on :9099
│   ├── status.go          # collectStatus(): CPU, RAM, uptime, network
│   ├── tailscale.go       # getTailscalePeers() via tailscale status
│   ├── types.go           # Shared types (DeviceState, WSMessage, etc.)
│   ├── wol.go             # Wake-on-LAN wrapper
│   ├── actions_unix.go    # suspend() for Linux/macOS
│   ├── actions_windows.go # suspend() for Windows
│   ├── main_unix.go       # Unix service detection (no-op)
│   └── main_windows.go    # Windows Service support
└── pkg/wol/
    └── wol.go             # WoL magic packet builder

worker/src/
├── index.ts               # Fetch handler: auth, /ws routing, static assets
├── DeviceDO.ts            # Durable Object: state store + WebSocket broker
├── auth.ts                # Google OAuth via OpenAuth
└── env.d.ts               # Env type declarations

src/
├── App.tsx                # Main UI: auth gate, device grid, toasts
├── api.ts                 # WebSocket client, auth helpers, MAC cache
├── schema.ts              # Effect Schema definitions
└── components/
    └── DeviceCard.tsx     # Per-device card (online: bars + actions; offline: wake)

scripts/
├── install-hub-agent.sh       # Linux hub installer (systemd)
├── install-leaf-agent.sh      # Linux leaf installer (systemd)
├── install-leaf-agent.sh.macos # macOS leaf installer (launchd)
└── install-leaf-agent.ps1     # Windows leaf installer (Service)
```

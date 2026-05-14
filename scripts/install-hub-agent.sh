#!/usr/bin/env bash
set -euo pipefail

BINARY="$HOME/.local/bin/simple-devices"
SERVICE_FILE="/etc/systemd/system/simple-devices-hub.service"
HUB_URL="${SIMPLE_DEVICES_HUB:-}"

echo "=== simple-devices hub agent installer (Linux) ==="

if [ -z "$HUB_URL" ]; then
    echo "Error: SIMPLE_DEVICES_HUB env var must be set to the wss:// URL of your DO"
    echo "Example: SIMPLE_DEVICES_HUB=wss://simple-devices.yourname.workers.dev/ws ./install-hub-agent.sh"
    exit 1
fi

if [ ! -f "$BINARY" ]; then
    echo "Error: binary not found at $BINARY"
    echo "Build first: GOOS=linux GOARCH=amd64 go build -o $BINARY ./cmd/simple-devices"
    exit 1
fi

echo "Binary: $BINARY"
echo "Hub URL: $HUB_URL"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=simple-devices hub agent
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BINARY -hub=$HUB_URL
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=simple-devices-hub

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable simple-devices-hub
sudo systemctl start simple-devices-hub

echo "Hub service installed and started."
echo "Check status: systemctl status simple-devices-hub"
echo "Check logs:   journalctl -u simple-devices-hub -f"

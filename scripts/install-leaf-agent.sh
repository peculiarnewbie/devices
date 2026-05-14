#!/usr/bin/env bash
set -euo pipefail

BINARY="$HOME/.local/bin/simple-devices"
SERVICE_FILE="/etc/systemd/system/simple-devices-agent.service"

echo "=== simple-devices leaf agent installer (Linux) ==="

if [ ! -f "$BINARY" ]; then
    echo "Error: binary not found at $BINARY"
    echo "Build first: GOOS=linux GOARCH=amd64 go build -o $BINARY ./cmd/simple-devices"
    exit 1
fi

echo "Binary: $BINARY"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=simple-devices leaf agent
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BINARY
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=simple-devices-agent

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable simple-devices-agent
sudo systemctl start simple-devices-agent

echo "Service installed and started."
echo "Check status: systemctl status simple-devices-agent"
echo "Check logs:   journalctl -u simple-devices-agent -f"

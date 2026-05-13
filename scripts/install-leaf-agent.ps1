#Requires -RunAsAdministrator

param(
    [string]$Binary = "$env:USERPROFILE\.local\bin\simple-devices-agent.exe",
    [string]$Port = "9099"
)

Write-Host "=== simple-devices leaf agent installer (Windows) ==="

if (-not (Test-Path $Binary)) {
    Write-Host "Error: binary not found at $Binary"
    Write-Host "Build the agent first: GOOS=windows GOARCH=amd64 go build -o $Binary .\cmd\agent"
    exit 1
}

Write-Host "Binary: $Binary"
Write-Host "Port: $Port"

$serviceName = "SimpleDevicesAgent"

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service $serviceName -Force
    sc.exe delete $serviceName
}

New-Service -Name $serviceName `
    -BinaryPathName """$Binary""" `
    -DisplayName "simple-devices agent" `
    -Description "Lightweight device state agent for simple-devices" `
    -StartupType Automatic

Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" -Name "Environment" -Value "SIMPLE_DEVICES_PORT=$Port"

Start-Service $serviceName

Write-Host "Service installed and started."
Write-Host "Check status: Get-Service $serviceName"

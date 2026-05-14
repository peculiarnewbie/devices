#Requires -RunAsAdministrator

param(
    [string]$Binary = "$env:USERPROFILE\.local\bin\simple-devices.exe"
)

Write-Host "=== simple-devices leaf agent installer (Windows) ==="

if (-not (Test-Path $Binary)) {
    Write-Host "Error: binary not found at $Binary"
    Write-Host "Build first: GOOS=windows GOARCH=amd64 go build -o $Binary .\cmd\simple-devices"
    exit 1
}

Write-Host "Binary: $Binary"

$serviceName = "SimpleDevicesAgent"

sc.exe delete $serviceName 2>&1 | Out-Null
Remove-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

sc.exe create $serviceName binPath= $Binary start= auto
sc.exe start $serviceName

Write-Host "Service installed and started."
Write-Host "Check status: Get-Service $serviceName"

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    #[serde(rename = "used_gb")]
    pub used_gb: f64,
    #[serde(rename = "total_gb")]
    pub total_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceState {
    pub hostname: String,
    #[serde(rename = "tailscale_ip")]
    pub tailscale_ip: String,
    pub os: String,
    pub macs: Vec<String>,
    pub subnet: String,
    pub uptime: u64,
    #[serde(rename = "cpu_percent")]
    pub cpu_percent: f64,
    pub memory: Memory,
    pub online: bool,
    #[serde(rename = "last_seen")]
    pub last_seen: i64,
}

use std::net::IpAddr;
use sysinfo::Networks;

#[derive(Debug, Default, Clone)]
pub struct NetInfo {
    pub tailscale_ip: String,
    pub subnet: String,
    pub macs: Vec<String>,
}

pub fn collect_net_info() -> NetInfo {
    let mut info = NetInfo::default();
    let mut seen_macs = std::collections::HashSet::<String>::new();

    let networks = Networks::new_with_refreshed_list();
    for (name, data) in networks.iter() {
        if name.starts_with("lo") {
            continue;
        }

        for network in data.ip_networks() {
            if let IpAddr::V4(ipv4) = network.addr {
                let octets = ipv4.octets();
                let is_tailscale = octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127;

                if is_tailscale && info.tailscale_ip.is_empty() {
                    info.tailscale_ip = ipv4.to_string();
                } else if !ipv4.is_loopback() && info.subnet.is_empty() {
                    let prefix = network.prefix;
                    let masked = apply_prefix(octets, prefix);
                    info.subnet = format!("{}.{}.{}.{}/{}", masked[0], masked[1], masked[2], masked[3], prefix);
                }
            }
        }

        let mac = data.mac_address();
        if !mac.is_unspecified() && seen_macs.insert(mac.to_string()) {
            info.macs.push(mac.to_string());
        }
    }

    info
}

fn apply_prefix(ip: [u8; 4], prefix: u8) -> [u8; 4] {
    let mask = u32::from_be_bytes([255, 255, 255, 255])
        .checked_shl((32 - prefix) as u32)
        .unwrap_or(0)
        .to_be_bytes();
    [
        ip[0] & mask[0],
        ip[1] & mask[1],
        ip[2] & mask[2],
        ip[3] & mask[3],
    ]
}

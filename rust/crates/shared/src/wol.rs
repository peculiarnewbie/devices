use std::net::UdpSocket;

pub fn build_packet(mac: &str) -> anyhow::Result<Vec<u8>> {
    let cleaned: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if cleaned.len() != 12 {
        anyhow::bail!("invalid mac address: {}", mac);
    }
    let mac_bytes = hex::decode(&cleaned)?;

    let mut packet = vec![0u8; 102];
    for i in 0..6 {
        packet[i] = 0xFF;
    }
    for i in 1..=16 {
        packet[i * 6..(i + 1) * 6].copy_from_slice(&mac_bytes);
    }

    Ok(packet)
}

pub fn send_wol(mac: &str) -> anyhow::Result<()> {
    let packet = build_packet(mac)?;
    let socket = UdpSocket::bind("0.0.0.0:0")?;
    socket.set_broadcast(true)?;
    socket.send_to(&packet, "255.255.255.255:9")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_valid_magic_packet() {
        let packet = build_packet("00:11:22:33:44:55").unwrap();
        assert_eq!(packet.len(), 102);
        assert_eq!(&packet[0..6], &[0xFF; 6]);
        for i in 1..=16 {
            assert_eq!(&packet[i * 6..(i + 1) * 6], &[0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
        }
    }

    #[test]
    fn accepts_dash_separated_mac() {
        let packet = build_packet("00-11-22-33-44-55").unwrap();
        assert_eq!(&packet[6..12], &[0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
    }

    #[test]
    fn rejects_invalid_mac() {
        assert!(build_packet("not-a-mac").is_err());
        assert!(build_packet("00:11:22:33:44").is_err());
        assert!(build_packet("").is_err());
    }
}

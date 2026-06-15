use std::process::Command;

#[cfg(target_os = "linux")]
pub fn suspend() -> anyhow::Result<()> {
    Command::new("systemctl").arg("suspend").status()?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn suspend() -> anyhow::Result<()> {
    Command::new("osascript")
        .arg("-e")
        .arg(r#"tell app "System Events" to sleep"#)
        .status()?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn suspend() -> anyhow::Result<()> {
    Command::new("rundll32.exe")
        .args(["powrprof.dll,SetSuspendState", "0", "1", "0"])
        .status()?;
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn suspend() -> anyhow::Result<()> {
    anyhow::bail!("suspend not supported on this OS")
}

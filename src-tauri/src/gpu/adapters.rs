//! The display adapters the OS knows, whether or not Vulkan sees them.
//!
//! A GPU with no vendor driver is invisible to Vulkan but not to the OS, and
//! it is the one the writer needs a driver for. Each platform's list is read
//! by a small, testable parser over what the OS prints or exposes.
//!
//! Windows: `Win32_VideoController` through PowerShell's CIM cmdlet, which
//! names the adapter, its PnP id (vendor and device even on Microsoft's basic
//! driver) and the driver's version, with no Windows API code of our own.
//! Linux: `/sys/class/drm/card*/device`, its PCI ids and the kernel driver.

use super::classify::Adapter;
use super::vendor;
use std::time::Duration;

/// What the platform's list costs at most; an adapter list that does not
/// come back in time is an empty list, not a wait.
const TIMEOUT: Duration = Duration::from_secs(10);

pub fn list() -> Vec<Adapter> {
    if cfg!(windows) {
        windows()
    } else if cfg!(target_os = "linux") {
        linux(std::path::Path::new("/sys/class/drm"))
    } else {
        Vec::new()
    }
}

/// A remote desktop session draws through Microsoft's remote adapter, so its
/// GPU answers are about that session, not the machine.
pub fn remote_session() -> bool {
    cfg!(windows) && std::env::var("SESSIONNAME").is_ok_and(|s| s.to_ascii_uppercase().starts_with("RDP-"))
}

const WINDOWS_QUERY: &str =
    "Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,DriverVersion | ConvertTo-Json -Compress";

fn windows() -> Vec<Adapter> {
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", WINDOWS_QUERY])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    match output_within(command, TIMEOUT) {
        Some(text) => parse_windows(&text),
        None => Vec::new(),
    }
}

fn output_within(mut command: std::process::Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    command.stdout(std::process::Stdio::piped());
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return reader.join().ok(),
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// `ConvertTo-Json` prints one object for one adapter and an array for more.
pub fn parse_windows(json: &str) -> Vec<Adapter> {
    let value: serde_json::Value = match serde_json::from_str(json.trim()) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        object @ serde_json::Value::Object(_) => vec![object],
        _ => return Vec::new(),
    };
    rows.iter()
        .filter_map(|row| {
            let name = row.get("Name")?.as_str()?.trim().to_string();
            let pnp = row.get("PNPDeviceID").and_then(|v| v.as_str()).unwrap_or_default();
            // Microsoft's basic driver has no PCI id of its own; the adapter
            // is still listed, as Microsoft, so "no vendor driver" can be said.
            let vendor_id = vendor::vendor_of_pnp_id(pnp).unwrap_or(if pnp.is_empty() || !pnp.to_ascii_uppercase().starts_with("PCI") { vendor::MICROSOFT } else { 0 });
            let basic = name.to_ascii_lowercase().contains("microsoft basic");
            Some(Adapter {
                name,
                vendor_id: if basic { vendor::MICROSOFT } else { vendor_id },
                device_id: vendor::device_of_pnp_id(pnp).unwrap_or(0),
                driver: row.get("DriverVersion").and_then(|v| v.as_str()).map(str::to_string).filter(|d| !d.is_empty()),
            })
        })
        .collect()
}

/// One card's PCI ids and kernel driver, read from sysfs.
pub fn linux(drm: &std::path::Path) -> Vec<Adapter> {
    let Ok(entries) = std::fs::read_dir(drm) else { return Vec::new() };
    let mut cards: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("card") && !n.contains('-')))
        .collect();
    cards.sort();
    cards
        .iter()
        .filter_map(|card| {
            let device = card.join("device");
            let read = |file: &str| std::fs::read_to_string(device.join(file)).ok();
            let driver = std::fs::read_link(device.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
            linux_adapter(&read("vendor")?, &read("device").unwrap_or_default(), driver)
        })
        .collect()
}

/// `0x10de` and `0x2504` as sysfs writes them, and the kernel driver's name.
pub fn linux_adapter(vendor_hex: &str, device_hex: &str, driver: Option<String>) -> Option<Adapter> {
    let hex = |s: &str| u32::from_str_radix(s.trim().trim_start_matches("0x"), 16).ok();
    let vendor_id = hex(vendor_hex)?;
    let slug = vendor::slug(vendor_id);
    let device_id = hex(device_hex).unwrap_or(0);
    Some(Adapter {
        name: format!("{} GPU {device_id:04x}", match slug { "nvidia" => "NVIDIA", "amd" => "AMD", "intel" => "Intel", _ => "Display" }),
        vendor_id,
        device_id,
        driver,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_lists_one_adapter_or_several() {
        let one = r#"{"Name":"NVIDIA GeForce RTX 3060","PNPDeviceID":"PCI\\VEN_10DE&DEV_2504&SUBSYS_1\\4&1","DriverVersion":"32.0.15.5222"}"#;
        let list = parse_windows(one);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].vendor_id, list[0].device_id), (vendor::NVIDIA, 0x2504));
        assert_eq!(list[0].driver.as_deref(), Some("32.0.15.5222"));

        let two = r#"[{"Name":"Intel(R) UHD Graphics 620","PNPDeviceID":"PCI\\VEN_8086&DEV_5917","DriverVersion":"31.0.101.2111"},
                      {"Name":"Microsoft Basic Display Adapter","PNPDeviceID":"PCI\\VEN_10DE&DEV_1F82","DriverVersion":"10.0.26100.1"}]"#;
        let list = parse_windows(two);
        assert_eq!(list[0].vendor_id, vendor::INTEL);
        // On the basic driver the adapter reads as Microsoft: no vendor driver.
        assert_eq!(list[1].vendor_id, vendor::MICROSOFT);
        assert_eq!(list[1].device_id, 0x1F82);
    }

    #[test]
    fn a_remote_or_root_adapter_without_a_pci_id_is_microsofts() {
        let rdp = r#"{"Name":"Microsoft Remote Display Adapter","PNPDeviceID":"SWD\\REMOTEDISPLAYENUM\\RDPIDD","DriverVersion":null}"#;
        let list = parse_windows(rdp);
        assert_eq!(list[0].vendor_id, vendor::MICROSOFT);
        assert_eq!(list[0].driver, None);
        assert!(parse_windows("").is_empty());
        assert!(parse_windows("not json").is_empty());
    }

    #[test]
    fn linux_reads_sysfs_ids_and_the_kernel_driver() {
        let a = linux_adapter("0x10de\n", "0x2504\n", Some("nvidia".into())).unwrap();
        assert_eq!((a.vendor_id, a.device_id, a.driver.as_deref()), (vendor::NVIDIA, 0x2504, Some("nvidia")));
        assert!(a.name.starts_with("NVIDIA"));
        assert!(linux_adapter("zz", "0x1", None).is_none());
    }

    #[test]
    fn linux_walks_cards_and_skips_connectors() {
        let dir = tempfile::tempdir().unwrap();
        for (card, vendor_hex, driver) in [("card0", "0x8086", "i915"), ("card1", "0x10de", "nvidia")] {
            let device = dir.path().join(card).join("device");
            std::fs::create_dir_all(&device).unwrap();
            std::fs::write(device.join("vendor"), vendor_hex).unwrap();
            std::fs::write(device.join("device"), "0x1234").unwrap();
            let target = dir.path().join(format!("drv-{driver}")).join(driver);
            std::fs::create_dir_all(&target).unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(&target, device.join("driver")).unwrap();
        }
        std::fs::create_dir_all(dir.path().join("card0-HDMI-A-1")).unwrap();
        let list = linux(dir.path());
        assert_eq!(list.len(), 2, "connectors are not cards");
        assert_eq!(list[0].vendor_id, vendor::INTEL);
        assert_eq!(list[1].driver.as_deref(), Some("nvidia"));
    }
}

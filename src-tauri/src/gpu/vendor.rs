//! Who made a GPU, and where its driver comes from.
//!
//! Pure: a vendor id in, a slug and a page out, so it is tested on every OS.
//! The ids are PCI vendor ids, which Vulkan reports as `vendorID` for the
//! three GPU vendors that matter here.

use serde::Serialize;

pub const NVIDIA: u32 = 0x10DE;
pub const AMD: u32 = 0x1002;
pub const INTEL: u32 = 0x8086;
/// Microsoft Basic Render / Basic Display / Remote Display: no vendor driver.
pub const MICROSOFT: u32 = 0x1414;
/// Mesa's software rasterizers (llvmpipe, lavapipe): a CPU pretending.
pub const MESA_SOFTWARE: u32 = 0x10005;
pub const APPLE: u32 = 0x106B;
const VIRTUAL: [u32; 4] = [0x15AD /* VMware */, 0x80EE /* VirtualBox */, 0x1AF4 /* virtio */, 0x1AB8 /* Parallels */];

/// Where a writer gets the driver for a vendor's GPU.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverSource {
    /// `nvidia` | `amd` | `intel`: the UI names the vendor from its own words.
    pub vendor: &'static str,
    pub url: &'static str,
}

/// A stable slug for a vendor id, or `other`.
pub fn slug(vendor_id: u32) -> &'static str {
    match vendor_id {
        NVIDIA => "nvidia",
        AMD => "amd",
        INTEL => "intel",
        MICROSOFT => "microsoft",
        APPLE => "apple",
        MESA_SOFTWARE => "software",
        id if VIRTUAL.contains(&id) => "virtual",
        _ => "other",
    }
}

/// Whether an adapter is a virtual machine's display, not a real GPU.
pub fn is_virtual(vendor_id: u32) -> bool {
    VIRTUAL.contains(&vendor_id)
}

/// Whether an adapter draws in software: no GPU work can happen on it.
pub fn is_software(vendor_id: u32) -> bool {
    vendor_id == MICROSOFT || vendor_id == MESA_SOFTWARE
}

/// The vendor's driver page, for the three vendors whose GPUs run ggml's
/// Vulkan backend. Pages that ask nothing of the writer but the GPU model.
pub fn driver_source(vendor_id: u32) -> Option<DriverSource> {
    let (vendor, url) = match vendor_id {
        NVIDIA => ("nvidia", "https://www.nvidia.com/Download/index.aspx"),
        AMD => ("amd", "https://www.amd.com/en/support/download/drivers.html"),
        INTEL => ("intel", "https://www.intel.com/content/www/us/en/support/detect.html"),
        _ => return None,
    };
    Some(DriverSource { vendor, url })
}

/// The `VEN_xxxx` of a Windows PnP device id (`PCI\VEN_10DE&DEV_2504&…`).
/// Lets a GPU running on Microsoft's basic driver be named by its maker.
pub fn vendor_of_pnp_id(pnp: &str) -> Option<u32> {
    let upper = pnp.to_ascii_uppercase();
    let start = upper.find("VEN_")? + 4;
    u32::from_str_radix(upper.get(start..start + 4)?, 16).ok()
}

/// The `DEV_xxxx` of a Windows PnP device id.
pub fn device_of_pnp_id(pnp: &str) -> Option<u32> {
    let upper = pnp.to_ascii_uppercase();
    let start = upper.find("DEV_")? + 4;
    u32::from_str_radix(upper.get(start..start + 4)?, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_gpu_vendors_have_a_driver_page_and_nobody_else_does() {
        for (id, vendor) in [(NVIDIA, "nvidia"), (AMD, "amd"), (INTEL, "intel")] {
            let source = driver_source(id).unwrap();
            assert_eq!(source.vendor, vendor);
            assert!(source.url.starts_with("https://"));
            assert_eq!(slug(id), vendor);
        }
        for id in [MICROSOFT, MESA_SOFTWARE, APPLE, 0x15AD, 0x1234] {
            assert!(driver_source(id).is_none(), "{id:#x}");
        }
    }

    #[test]
    fn software_and_virtual_adapters_are_told_apart_from_gpus() {
        assert!(is_software(MICROSOFT) && is_software(MESA_SOFTWARE));
        assert!(!is_software(NVIDIA));
        assert!(is_virtual(0x15AD) && is_virtual(0x80EE));
        assert_eq!(slug(0x80EE), "virtual");
        assert_eq!(slug(0x1234), "other");
    }

    #[test]
    fn a_pnp_id_names_the_vendor_and_device_behind_a_basic_driver() {
        let id = r"PCI\VEN_10DE&DEV_2504&SUBSYS_88971043&REV_A1\4&1A2B3C4D&0&0008";
        assert_eq!(vendor_of_pnp_id(id), Some(NVIDIA));
        assert_eq!(device_of_pnp_id(id), Some(0x2504));
        assert_eq!(vendor_of_pnp_id(r"pci\ven_8086&dev_9a49"), Some(INTEL));
        assert_eq!(vendor_of_pnp_id(r"ROOT\BasicDisplay\0000"), None);
        assert_eq!(vendor_of_pnp_id("VEN_12"), None);
    }
}

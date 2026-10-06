//! The probe: what Vulkan sees on this computer.
//!
//! Runs only inside `versorium --gpu-probe`, a process of its own: a driver
//! can crash or hang inside `vkCreateInstance`, and a thread could not stop
//! that from taking the app down. The loader is opened at run time
//! (`ash::Entry::load`), never linked, so its absence is an answer
//! (`LoaderMissing`), not a failure to start.
//!
//! Compiled everywhere so it is type-checked on every OS; `run` answers
//! `NotApplicable` where the engine is not built on Vulkan (macOS, and builds
//! without the `vulkan` feature).

use super::classify::{ProbeOutcome, VkDevice, VkFacts};

pub fn run() -> ProbeOutcome {
    if cfg!(target_os = "macos") || !cfg!(feature = "vulkan") {
        return ProbeOutcome::NotApplicable;
    }
    vulkan()
}

/// The device type as `classify` reads it.
fn kind(device_type: ash::vk::PhysicalDeviceType) -> &'static str {
    use ash::vk::PhysicalDeviceType as T;
    match device_type {
        T::DISCRETE_GPU => "discrete",
        T::INTEGRATED_GPU => "integrated",
        T::VIRTUAL_GPU => "virtual",
        T::CPU => "cpu",
        _ => "other",
    }
}

fn text(chars: &[std::ffi::c_char]) -> String {
    let bytes: Vec<u8> = chars.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn vulkan() -> ProbeOutcome {
    use ash::vk;
    // SAFETY: opening the system's Vulkan loader; nothing else holds it.
    let Ok(entry) = (unsafe { ash::Entry::load() }) else {
        return ProbeOutcome::LoaderMissing;
    };
    // SAFETY: a plain query on a loaded entry.
    let loader_version = unsafe { entry.try_enumerate_instance_version() }
        .ok()
        .map(|v| v.unwrap_or(vk::API_VERSION_1_0));
    let mut facts = VkFacts { loader_version, instance_error: None, devices: Vec::new() };
    // Ask for what ggml asks for; an older loader is reported, not created.
    if loader_version.is_some_and(|v| v < vk::API_VERSION_1_2) {
        return ProbeOutcome::Ran(facts);
    }
    let app = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_2);
    let create = vk::InstanceCreateInfo::default().application_info(&app);
    // SAFETY: a minimal instance, no layers or extensions, destroyed below.
    let instance = match unsafe { entry.create_instance(&create, None) } {
        Ok(instance) => instance,
        Err(error) => {
            facts.instance_error = Some(error.as_raw());
            return ProbeOutcome::Ran(facts);
        }
    };
    // SAFETY: queries on a live instance and the devices it returns.
    unsafe {
        if let Ok(devices) = instance.enumerate_physical_devices() {
            for device in devices {
                let props = instance.get_physical_device_properties(device);
                let mut storage = vk::PhysicalDevice16BitStorageFeatures::default();
                let mut features = vk::PhysicalDeviceFeatures2::default().push_next(&mut storage);
                instance.get_physical_device_features2(device, &mut features);
                let storage_16bit = storage.storage_buffer16_bit_access == vk::TRUE;
                let mut driver = vk::PhysicalDeviceDriverProperties::default();
                if props.api_version >= vk::API_VERSION_1_2 {
                    let mut props2 = vk::PhysicalDeviceProperties2::default().push_next(&mut driver);
                    instance.get_physical_device_properties2(device, &mut props2);
                }
                let memory = instance.get_physical_device_memory_properties(device);
                let device_local: u64 = memory
                    .memory_heaps_as_slice()
                    .iter()
                    .filter(|h| h.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL))
                    .map(|h| h.size)
                    .sum();
                facts.devices.push(VkDevice {
                    name: text(&props.device_name),
                    vendor_id: props.vendor_id,
                    device_id: props.device_id,
                    device_type: kind(props.device_type).to_string(),
                    api_version: props.api_version,
                    driver_info: text(&driver.driver_info),
                    storage_16bit,
                    memory_mb: device_local / (1024 * 1024),
                });
            }
        }
        instance.destroy_instance(None);
    }
    ProbeOutcome::Ran(facts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mac_or_a_build_without_vulkan_does_not_open_vulkan() {
        if cfg!(target_os = "macos") || !cfg!(feature = "vulkan") {
            assert_eq!(run(), ProbeOutcome::NotApplicable);
        }
    }

    #[test]
    fn device_types_read_as_classify_expects() {
        use ash::vk::PhysicalDeviceType as T;
        assert_eq!(kind(T::DISCRETE_GPU), "discrete");
        assert_eq!(kind(T::INTEGRATED_GPU), "integrated");
        assert_eq!(kind(T::CPU), "cpu");
        assert_eq!(kind(T::VIRTUAL_GPU), "virtual");
        assert_eq!(kind(T::OTHER), "other");
    }

    /// On this machine, for real: `cargo test -- --ignored live_gpu_probe`.
    #[test]
    #[ignore = "opens this computer's Vulkan loader"]
    fn live_gpu_probe_answers() {
        let outcome = vulkan();
        eprintln!("{}", serde_json::to_string_pretty(&outcome).unwrap());
        assert!(!matches!(outcome, ProbeOutcome::Crashed { .. } | ProbeOutcome::TimedOut));
    }
}

//! What this machine can actually run.
//!
//! Spec §6.2: the wizard "preselecciona el pack más grande con 20% de margen".
//! The margin matters — a model whose weights exactly fill RAM will swap, and
//! swapping a 10 GB model makes the app feel broken. The recommendation is only
//! ever a preselection: nothing is downloaded without a click, and HIGH is
//! never auto-downloaded at all.

use super::catalog;
use serde::Serialize;

/// Leave a fifth of memory for the OS, the editor and the webview.
const HEADROOM: f32 = 1.2;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub total_ram_gb: f32,
    pub available_ram_gb: f32,
    pub cpu_cores: usize,
    pub arch: String,
    pub os: String,
    pub gpu: String,
    pub recommended_tier: String,
}

fn gpu_description() -> String {
    // Cheap and honest: no vendor tools shelled out just to draw a label.
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "Apple Silicon — Metal, unified memory".to_string()
    } else {
        "unknown".to_string()
    }
}

pub fn probe() -> Hardware {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let to_gb = |bytes: u64| bytes as f32 / 1_073_741_824.0;
    let total_ram_gb = to_gb(system.total_memory());

    Hardware {
        total_ram_gb,
        available_ram_gb: to_gb(system.available_memory()),
        cpu_cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        arch: std::env::consts::ARCH.to_string(),
        os: std::env::consts::OS.to_string(),
        gpu: gpu_description(),
        recommended_tier: recommend(total_ram_gb).to_string(),
    }
}

/// Heaviest RAM hint per tier, in `catalog::TIERS` order. `None` where the
/// catalog has no writing model for that tier.
fn tier_requirements() -> [Option<f32>; 4] {
    let mut needs = [None; 4];
    let Ok(catalog) = catalog::catalog() else { return needs };
    for model in &catalog.models {
        if model.task != "writing" {
            continue;
        }
        if let Some(index) = catalog::TIERS.iter().position(|t| *t == model.tier) {
            let slot = &mut needs[index];
            *slot = Some(slot.map_or(model.ram_hint_gb, |current: f32| current.max(model.ram_hint_gb)));
        }
    }
    needs
}

/// Largest tier whose heaviest model still fits with the headroom.
fn largest_fitting(needs: [Option<f32>; 4], total_ram_gb: f32) -> &'static str {
    let mut best = catalog::TIERS[0];
    for (index, need) in needs.iter().enumerate() {
        if let Some(need) = need {
            if need * HEADROOM <= total_ram_gb {
                best = catalog::TIERS[index];
            }
        }
    }
    best
}

/// The tier the wizard preselects for a machine with this much RAM.
pub fn recommend(total_ram_gb: f32) -> &'static str {
    largest_fitting(tier_requirements(), total_ram_gb)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Representative of the real ladder: ~2 GB low, ~3.5 GB mid, ~10 GB
    /// mid-plus, ~22 GB high.
    const LADDER: [Option<f32>; 4] = [Some(2.0), Some(3.5), Some(10.0), Some(22.0)];

    #[test]
    fn every_machine_gets_the_largest_tier_that_fits_with_headroom() {
        // Each expectation is the largest tier whose hint * 1.2 still fits.
        for (ram_gb, expected) in [
            (4.0, "low"),      // mid would need 4.2
            (8.0, "mid"),      // midPlus would need 12.0
            (16.0, "midPlus"), // high would need 26.4
            (32.0, "high"),    // 26.4 fits
            (64.0, "high"),
        ] {
            assert_eq!(largest_fitting(LADDER, ram_gb), expected, "{ram_gb} GB");
        }
    }

    #[test]
    fn the_headroom_is_really_twenty_percent() {
        // A tier needing 10 GB is offered at 12 GB and withheld just below it.
        assert_eq!(largest_fitting(LADDER, 12.0), "midPlus");
        assert_eq!(largest_fitting(LADDER, 11.9), "mid");
    }

    #[test]
    fn a_tiny_machine_still_gets_something_to_run() {
        // Never nothing: the smallest tier is the floor, even at 1 GB.
        assert_eq!(largest_fitting(LADDER, 1.0), "low");
        assert_eq!(largest_fitting([None; 4], 64.0), "low");
    }

    #[test]
    fn gaps_in_the_ladder_do_not_skip_a_tier_upward() {
        // No midPlus published: a big machine stops at mid rather than jumping.
        let sparse = [Some(2.0), Some(3.5), None, Some(22.0)];
        assert_eq!(largest_fitting(sparse, 16.0), "mid");
    }

    #[test]
    fn probing_reports_this_machine_without_panicking() {
        let hardware = probe();
        assert!(hardware.total_ram_gb > 0.0);
        assert!(hardware.cpu_cores >= 1);
        assert_eq!(hardware.os, std::env::consts::OS);
        assert!(catalog::TIERS.contains(&hardware.recommended_tier.as_str()));
    }
}

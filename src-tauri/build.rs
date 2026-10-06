fn main() {
    tauri_build::build();
    delay_load_vulkan();
}

/// Windows with the Vulkan backend: start without the Vulkan loader.
///
/// llama-cpp-sys-2 links vulkan-1.dll as a load-time import, so on a computer
/// with no Vulkan (no GPU driver) Windows refused to start the app at all.
/// Delay-loaded, the DLL is opened at the first call instead, which only
/// happens once the GPU check (src/gpu) allows the engine and
/// `delayguard.c` has bound the imports under SEH. release.yml checks the
/// built exe lists vulkan-1.dll among its delay-load imports, not its
/// load-time ones.
fn delay_load_vulkan() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" || std::env::var_os("CARGO_FEATURE_VULKAN").is_none() {
        return;
    }
    println!("cargo:rerun-if-changed=src/gpu/delayguard.c");
    println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
    println!("cargo:rustc-link-arg=delayimp.lib");
    cc::Build::new().file("src/gpu/delayguard.c").compile("versorium_delayguard");
}

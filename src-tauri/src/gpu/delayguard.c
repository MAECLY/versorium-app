/*
 * Windows (MSVC) with the Vulkan backend only: bind vulkan-1.dll's imports
 * before llama.cpp starts, under SEH.
 *
 * vulkan-1.dll is delay-loaded (/DELAYLOAD in build.rs), so the app starts on
 * a computer without the Vulkan loader. The first call into a delay-loaded
 * DLL that is missing raises 0xC06D007E (0xC06D007F for a missing export),
 * which neither C++'s catch(...) under /EHsc nor Rust can catch: the process
 * would die. Binding every import here, once, turns that into a return code;
 * after it succeeds no later call can fault, and the DLL is never unloaded.
 *
 * Returns 0 when bound; otherwise the SEH code or the HRESULT.
 */
#include <windows.h>
#include <delayimp.h>

long versorium_bind_vulkan(void) {
    __try {
        HRESULT hr = __HrLoadAllImportsForDll("vulkan-1.dll");
        return FAILED(hr) ? (long)hr : 0;
    } __except (GetExceptionCode() == VcppException(ERROR_SEVERITY_ERROR, ERROR_MOD_NOT_FOUND) ||
                        GetExceptionCode() == VcppException(ERROR_SEVERITY_ERROR, ERROR_PROC_NOT_FOUND)
                    ? EXCEPTION_EXECUTE_HANDLER
                    : EXCEPTION_CONTINUE_SEARCH) {
        return (long)GetExceptionCode();
    }
}

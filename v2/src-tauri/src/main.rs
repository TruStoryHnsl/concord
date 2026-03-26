// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix WebKitGTK blank window on NVIDIA + Wayland (Linux).
    // This must be set before any GTK initialization.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("XDG_SESSION_TYPE").unwrap_or_default() == "wayland" {
            // SAFETY: Called before any threads are spawned or GTK is initialized.
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); }
        }
    }

    concord_app::run();
}

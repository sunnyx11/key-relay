// Tauri embeds the application resources at build time.
fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
    // Tauri's mock runtime links TaskDialogIndirect, which requires Common Controls v6.
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
}

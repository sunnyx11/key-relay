// Tauri embeds the application resources at build time.
fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
}

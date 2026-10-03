//! Exercise the same official updater download and signature verification used by the application.
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

fn download_fixture(tampered: bool, version: &str) -> Result<Vec<u8>, tauri_plugin_updater::Error> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let signature = include_str!("fixtures/updater/package.txt.sig").trim();
    let manifest = serde_json::json!({
        "version": version, "notes": "Fixture release", "pub_date": "2026-10-04T00:00:00Z",
        "platforms": { "windows-x86_64": { "signature": signature, "url": format!("{endpoint}/package") } }
    }).to_string();
    let server = thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut served = 0;
        while served < 2 && std::time::Instant::now() < deadline {
            let (mut socket, _) = match listener.accept() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("fixture server: {error}"),
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 4096];
            let count = socket.read(&mut request).unwrap();
            let body = if request[..count].starts_with(b"GET /package ") {
                if tampered {
                    b"modified bytes".to_vec()
                } else {
                    include_bytes!("fixtures/updater/package.txt").to_vec()
                }
            } else {
                manifest.as_bytes().to_vec()
            };
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            socket.write_all(&body).unwrap();
            served += 1;
        }
        assert_eq!(served, 2);
    });
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": include_str!("fixtures/updater/public.key").trim(),
            "dangerousInsecureTransportProtocol": true,
            "requireSignedVersion": true
        }),
    );
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let result = tauri::async_runtime::block_on(async {
        let update = app
            .updater_builder()
            .endpoints(vec![endpoint.parse().unwrap()])?
            .timeout(Duration::from_secs(3))
            .build()?
            .check()
            .await?
            .expect("newer fixture version");
        update.download(|_, _| {}, || {}).await
    });
    server.join().unwrap();
    result
}

#[test]
fn signed_download_accepts_original_and_rejects_tampering_and_false_versions() {
    assert_eq!(
        download_fixture(false, "99.0.0").unwrap(),
        include_bytes!("fixtures/updater/package.txt")
    );
    assert!(download_fixture(true, "99.0.0").is_err());
    assert!(download_fixture(false, "99.0.1").is_err());
}

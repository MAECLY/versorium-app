//! Does `Authorization` follow a redirect off the host it was meant for?
//!
//! Two loopback listeners stand in for the two hosts of a GitHub asset
//! download: "home" plays api.github.com, "away" plays the storage host the API
//! redirects to. They differ by port, which both reqwest versions count as a
//! different host. Every request is logged with the `Authorization` it carried,
//! so the output says, hop by hop, where the token went.
//!
//! Default client settings throughout: this measures the libraries, not the
//! app's own redirect policy.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

/// (server, path, the Authorization header if any)
type Log = Arc<Mutex<Vec<(&'static str, String, Option<String>)>>>;

/// A route answers either with a redirect to `Some(location)` or with 200.
fn spawn(listener: TcpListener, name: &'static str, routes: Vec<(String, Option<String>)>, log: Log) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
            let mut request_line = String::new();
            if reader.read_line(&mut request_line).is_err() {
                continue;
            }
            let path = request_line.split_whitespace().nth(1).unwrap_or("").to_string();
            let mut authorization = None;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let line = line.trim_end();
                if line.is_empty() {
                    break;
                }
                if let Some((key, value)) = line.split_once(':') {
                    if key.eq_ignore_ascii_case("authorization") {
                        authorization = Some(value.trim().to_string());
                    }
                }
            }
            log.lock().unwrap().push((name, path.clone(), authorization));
            let response = match routes.iter().find(|(p, _)| *p == path) {
                Some((_, Some(location))) => format!(
                    "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                ),
                Some((_, None)) => "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".into(),
                None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            };
            let _ = stream.write_all(response.as_bytes());
        }
    });
}

#[tokio::main]
async fn main() {
    // What tauri-plugin-updater does before it builds its client.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let home_listener = TcpListener::bind("127.0.0.1:0").expect("bind home");
    let away_listener = TcpListener::bind("127.0.0.1:0").expect("bind away");
    let home = format!("http://127.0.0.1:{}", home_listener.local_addr().unwrap().port());
    let away = format!("http://127.0.0.1:{}", away_listener.local_addr().unwrap().port());
    let log: Log = Arc::default();

    spawn(
        home_listener,
        "home",
        vec![
            ("/one-hop".into(), Some(format!("{away}/final"))),
            ("/two-hops".into(), Some(format!("{away}/hop1"))),
            ("/round-trip".into(), Some(format!("{away}/bounce"))),
            ("/back".into(), None),
        ],
        log.clone(),
    );
    spawn(
        away_listener,
        "away",
        vec![
            ("/final".into(), None),
            ("/hop1".into(), Some(format!("{away}/hop2"))),
            ("/hop2".into(), None),
            ("/bounce".into(), Some(format!("{home}/back"))),
        ],
        log.clone(),
    );

    println!("home = {home}   away = {away}\n");
    let mut leaked = Vec::new();
    for version in ["0.12.28", "0.13.5"] {
        for path in ["/one-hop", "/two-hops", "/round-trip"] {
            log.lock().unwrap().clear();
            let url = format!("{home}{path}");
            let outcome = match version {
                "0.12.28" => reqwest012::Client::new()
                    .get(&url)
                    .header("authorization", "Bearer probe-token")
                    .send()
                    .await
                    .map(|r| r.status().as_u16())
                    .map_err(|e| e.to_string()),
                _ => reqwest013::Client::new()
                    .get(&url)
                    .header("authorization", "Bearer probe-token")
                    .send()
                    .await
                    .map(|r| r.status().as_u16())
                    .map_err(|e| e.to_string()),
            };
            println!("reqwest {version}  GET {path}  -> {outcome:?}");
            for (server, hop, authorization) in log.lock().unwrap().iter() {
                let carried = authorization.as_deref().unwrap_or("(no Authorization header)");
                let flag = if *server == "away" && authorization.is_some() {
                    leaked.push(format!("reqwest {version} {path}: away{hop}"));
                    "   <-- token reached the other host"
                } else {
                    ""
                };
                println!("    {server:<4} {hop:<11} {carried}{flag}");
            }
            println!();
        }
    }

    if leaked.is_empty() {
        println!("RESULT: Authorization never reached the other host.");
    } else {
        println!("RESULT: Authorization reached the other host on {} hop(s):", leaked.len());
        for hop in leaked {
            println!("  - {hop}");
        }
    }
}

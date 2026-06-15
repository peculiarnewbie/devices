use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;
use simple_devices_shared::{
    collect_metrics, collect_net_info, get_hostname, send_wol, suspend, CpuSampler, DeviceState,
    Memory,
};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tracing::{info, warn};

#[cfg(windows)]
mod windows_service;

#[derive(Clone)]
struct AppState {
    cpu_sampler: CpuSampler,
    system: Arc<Mutex<System>>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    if try_run_as_service() {
        return Ok(());
    }

    run_server().await
}

pub async fn run_server() -> anyhow::Result<()> {
    let cpu_sampler = CpuSampler::new();
    cpu_sampler.start();

    let state = AppState {
        cpu_sampler,
        system: Arc::new(Mutex::new(System::new())),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/status", get(status))
        .route("/sleep", post(sleep))
        .route("/wake", post(wake))
        .with_state(state);

    let port = std::env::var("SIMPLE_DEVICES_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9099u16);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("agent listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health() -> impl IntoResponse {
    Json(json!({"status": "ok"}))
}

async fn status(State(state): State<AppState>) -> impl IntoResponse {
    let mut system = state.system.lock().unwrap_or_else(|e| e.into_inner());
    let metrics = collect_metrics(&mut system, &state.cpu_sampler);
    let net = collect_net_info();

    let state = DeviceState {
        hostname: get_hostname(),
        tailscale_ip: net.tailscale_ip,
        os: std::env::consts::OS.to_string(),
        macs: net.macs,
        subnet: net.subnet,
        uptime: metrics.uptime,
        cpu_percent: metrics.cpu_percent,
        memory: Memory {
            used_gb: metrics.memory_used_gb,
            total_gb: metrics.memory_total_gb,
        },
        online: true,
        last_seen: now_ms(),
    };

    Json(state)
}

async fn sleep() -> impl IntoResponse {
    info!("sleep requested");
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        if let Err(err) = suspend() {
            warn!("sleep failed: {}", err);
        }
    });

    Json(json!({"action": "sleep", "status": "ok"}))
}

#[derive(Deserialize)]
struct WakeRequest {
    mac: String,
}

async fn wake(Json(body): Json<WakeRequest>) -> impl IntoResponse {
    if body.mac.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "missing mac field"})));
    }

    info!("sending magic packet to {}", body.mac);
    match send_wol(&body.mac) {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({"action": "wake", "mac": body.mac, "status": "ok"})),
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("wol failed: {}", err)})),
        ),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(not(windows))]
fn try_run_as_service() -> bool {
    false
}

#[cfg(windows)]
fn try_run_as_service() -> bool {
    crate::windows_service::try_run()
}

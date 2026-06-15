# Rust Migration Plan

## Goal

Reduce the memory and binary-size footprint of the leaf agents (and eventually the hub) by rewriting the Go components in Rust. The Cloudflare Worker and SolidJS frontend stay as-is.

## Why Rust here

- **Leaf agents run on every device**, so per-agent savings multiply.
- The current Go binary is ~10 MB and idle RSS is roughly 10–20 MB (runtime + gopsutil).
- A Rust leaf agent can realistically be **<3 MB binary** and **<5 MB RSS**, with much faster startup.
- The agent/hub logic is small and network-shaped: HTTP server, JSON, WebSocket, system metrics, subprocess calls, UDP broadcast. Rust handles this well.

## Scope

### Phase 1: Leaf agent only

Rewrite `go/cmd/simple-devices/` agent mode to Rust. Leave the Go hub running. The Rust agent must speak the exact same HTTP contract on `:9099`:

- `GET /health`
- `GET /status`
- `POST /sleep`
- `POST /wake`

### Phase 2: Hub (optional)

If Phase 1 proves the savings are worth it, rewrite the hub mode too. The hub has more moving parts (Tailscale discovery, WebSocket client to DO, concurrent polling, WoL relay), so it is a larger project.

### Out of scope

- Cloudflare Worker (`worker/src/`) stays TypeScript.
- SolidJS frontend (`src/`) stays as-is; only schema/types may be adjusted if the Rust agent changes the wire format.
- Auth stays unchanged.

## Target architecture

```
Browser UI  ←─ws─→  Cloudflare DO (DeviceDO)  ←─ws─→  Hub Agent (Go, later Rust)
                                                         │
                                                    Tailscale mesh
                                                         │
                                                   Leaf Agents (Rust, :9099)
```

## Crate selection

| Concern | Proposed crate | Notes |
|---|---|---|
| Async runtime | `tokio` | Standard; needed for axum + tungstenite |
| HTTP server | `axum` | Small, ergonomic, integrates with tokio |
| JSON | `serde` + `serde_json` | Zero-cost, well known |
| WebSocket client (hub) | `tokio-tungstenite` | Stable, async |
| System metrics | `sysinfo` | Cross-platform CPU/RAM/uptime/network |
| Network interfaces | `sysinfo` + manual platform code | For MACs and subnet |
| Wake-on-LAN | Custom UDP | Trivial to implement |
| Windows service | `windows-service` | Equivalent to `golang.org/x/sys/windows/svc` |
| Logging | `tracing` + `tracing-subscriber` | Structured, lightweight |
| CLI | `clap` or manual args | Keep small; current flags are just `-hub` and `-secret` |

## Project layout

```
rust/
├── Cargo.toml
├── crates/
│   ├── agent/          # Leaf agent binary
│   ├── hub/            # Hub agent binary (Phase 2)
│   └── shared/         # Types, WoL, network helpers, platform commands
```

Keeping `agent` and `hub` as separate crates lets each binary stay minimal. `shared` holds `DeviceState`, wake-on-LAN, suspend helpers, and subnet/MAC collection.

## Platform support

Match the current Go targets:

- Linux amd64/arm64
- macOS arm64 (Apple Silicon)
- Windows amd64

### Cross-compilation strategy

Go makes this trivial. Rust does not. Options:

1. **`cargo-zigbuild`** (recommended) — easiest cross-compilation for Linux/macOS/Windows from a Linux CI runner.
2. **`cross`** — uses Docker; heavier but more robust for exotic targets.
3. **GitHub Actions matrix** with native runners — macOS builds on macOS, Windows on Windows, Linux on Linux.

For releases, a GitHub Actions workflow that builds all targets and attaches binaries is the cleanest replacement for the current manual `GOOS=... go build` instructions.

## Migration phases

### Phase 0: Spike (1–2 days)

- Create a minimal Rust agent that exposes `/health` and `/status` with fake data.
- Build it for one platform, measure binary size and RSS next to the Go agent.
- Decide if the savings justify finishing the rewrite.

### Phase 1: Rust leaf agent (3–5 days)

1. Scaffold `rust/` workspace with `shared` and `agent` crates.
2. Port system metrics collection:
   - CPU percent via `sysinfo` background task (mirroring the new async sampler)
   - RAM usage
   - Uptime
   - MAC addresses + subnet
3. Implement HTTP endpoints (`/health`, `/status`, `/sleep`, `/wake`).
4. Implement suspend for Linux/macOS/Windows.
5. Implement Wake-on-LAN UDP broadcast.
6. Add installers/scripts for systemd/launchd/Windows Service.
7. Run the Rust agent alongside the Go hub and verify end-to-end.

### Phase 2: Rust hub (5–7 days, optional)

1. Port Tailscale peer discovery (`tailscale status --json`).
2. Port WebSocket client to DO with auto-reconnect.
3. Port concurrent device polling with timeouts.
4. Port command execution and WoL relay logic.
5. Replace the Go hub binary in deployment docs/scripts.

## Testing strategy

- Unit tests for WoL packet construction, MAC/subnet parsing, and command routing.
- Integration tests that spin up the agent on localhost and hit `/status`, `/sleep`, `/wake` with mocked suspend/WoL backends.
- Run the Rust agent against the existing `worker/src/__tests__/device-do.test.ts` suite indirectly by having it connect to the DO in local dev.
- Keep the existing frontend/schema tests; they validate the wire format.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `sysinfo` behaves differently on macOS/Windows | Test on real hardware or CI runners for each target early |
| Cross-compilation is painful | Use `cargo-zigbuild`; start with Linux x64 and add targets incrementally |
| Binary size reduction is smaller than expected | Strip + LTO + `codegen-units=1`; compare before committing to full rewrite |
| Longer build times in dev | Keep `cargo check` fast; use `cargo-watch` for local dev |
| Windows service crate complexity | Port the existing service logic directly; test as a real service |

## Expected outcome

| Metric | Go (current) | Rust (target) |
|---|---|---|
| Leaf binary size | ~10 MB | 1–3 MB |
| Leaf idle RSS | 10–20 MB | 2–5 MB |
| `/status` latency | ~1 s (CPU sample) | <10 ms (cached CPU) |
| Build complexity | Low | Medium |

## First step

Create the spike: a single `rust/` workspace with one `agent` crate that returns a hardcoded `/status` JSON and builds for the current platform. Compare binary size and memory before investing in full metrics porting.

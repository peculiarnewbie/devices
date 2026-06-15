# simple-devices-agent (Rust)

Drop-in Rust replacement for the Go leaf agent.

## Build

```bash
cd rust
cargo build --release
```

Binary: `target/release/simple-devices-agent`

## Run

```bash
./target/release/simple-devices-agent
```

The agent listens on `0.0.0.0:9099`. Override the port with:

```bash
SIMPLE_DEVICES_PORT=9098 ./target/release/simple-devices-agent
```

## Endpoints

- `GET /health` — health check
- `GET /status` — device status (CPU, memory, uptime, network)
- `POST /sleep` — suspend the machine
- `POST /wake` — send Wake-on-LAN magic packet (`{"mac":"..."}`)

## Test

```bash
cargo test
```

## Cross-compile

Use `cargo-zigbuild`:

```bash
cargo zigbuild --release --target x86_64-pc-windows-msvc
cargo zigbuild --release --target x86_64-unknown-linux-musl
cargo zigbuild --release --target aarch64-apple-darwin
```

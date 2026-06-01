import { describe, it, expect } from "vitest";

// @ts-expect-error - cloudflare:workers module provided by workerd runtime
const { env } = await import("cloudflare:workers");
// @ts-expect-error - cloudflare:test module provided by vitest-pool-workers
const { runInDurableObject } = await import("cloudflare:test");

const HUB_ID = env.DEVICE_HUB.idFromName("test-hub");

async function connectWs(id = HUB_ID): Promise<WebSocket> {
  const stub = env.DEVICE_HUB.get(id);
  const response = await stub.fetch("http://fake-host/ws", {
    headers: { Upgrade: "websocket" },
  });
    // @ts-expect-error - webSocket is a workerd Response property
  const ws: WebSocket = response.webSocket;
  // @ts-expect-error - ws.accept() is a workerd method
  ws.accept();
  return ws;
}

async function drainMessage(ws: WebSocket): Promise<void> {
  try {
    await waitForMessage(ws, 500);
  } catch {
    // no message to drain
  }
}

function waitForMessage(ws: WebSocket, timeout = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(event.data as string);
    }, { once: true });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("DeviceDO WebSocket", () => {
  it("rejects non-WebSocket requests", async () => {
    const stub = env.DEVICE_HUB.get(env.DEVICE_HUB.idFromName("test-reject"));
    const res = await stub.fetch("http://fake-host/ws");
    expect(res.status).toBe(426);
  });

  it("hub registers and UI receives state", async () => {
    const hub = await connectWs();
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    const ui = await connectWs();
    ui.send(JSON.stringify({ type: "register", role: "ui" }));

    const raw = await waitForMessage(ui);
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("state");
    expect(typeof msg.hub_connected).toBe("boolean");
    expect(Array.isArray(msg.devices)).toBe(true);

    hub.close();
    ui.close();
  });

  it("hub sends update and UI gets broadcast", async () => {
    const hub = await connectWs();
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    const ui = await connectWs();
    ui.send(JSON.stringify({ type: "register", role: "ui" }));
    await waitForMessage(ui);

    const device = {
      hostname: "node-1",
      tailscale_ip: "100.1.2.3",
      os: "linux",
      macs: ["aa:bb:cc:dd:ee:ff"],
      interfaces: [{ name: "eth0", mac: "aa:bb:cc:dd:ee:ff", addrs: ["192.168.1.1/24"] }],
      subnet: "192.168.1.0/24",
      uptime: 3600,
      cpu_percent: 45.2,
      memory: { used_gb: 4.2, total_gb: 16 },
      disk: { used_gb: 120, total_gb: 512 },
      online: true,
      last_seen: Date.now(),
    };
    hub.send(JSON.stringify({ type: "update", devices: [device] }));

    const raw2 = await waitForMessage(ui);
    const stateMsg = JSON.parse(raw2);
    expect(stateMsg.type).toBe("state");
    expect(stateMsg.devices).toHaveLength(1);
    const received = stateMsg.devices[0];
    expect(received.hostname).toBe("node-1");
    expect(received.online).toBe(true);
    expect(received.cpu_percent).toBeCloseTo(45.2);

    hub.close();
    ui.close();
  });

  it("rejects update from non-hub role", async () => {
    const id = env.DEVICE_HUB.idFromName("test-unauth");
    const ws = await connectWs(id);
    ws.send(JSON.stringify({ type: "register", role: "ui" }));

    ws.send(JSON.stringify({ type: "update", devices: [] }));
    await sleep(100);

    ws.send(JSON.stringify({ type: "refresh" }));
    const raw = await waitForMessage(ws);
    const msg = JSON.parse(raw);
    expect(msg.devices).toEqual([]);

    ws.close();
  });

  it("rejects malformed messages gracefully", async () => {
    const id = env.DEVICE_HUB.idFromName("test-malformed");
    const ws = await connectWs(id);

    ws.send("not valid json");
    await sleep(100);

    ws.send(JSON.stringify({ type: "register", role: "ui" }));
    const raw = await waitForMessage(ws);
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("state");

    ws.close();
  });

  it("command forwards to hub when connected", async () => {
    const hub = await connectWs();
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    hub.send(JSON.stringify({
      type: "update",
      devices: [{
        hostname: "node-cmd",
        tailscale_ip: "100.1.2.50",
        os: "linux",
        macs: ["aa:bb:cc:dd:ee:ff"],
        interfaces: [{ name: "eth0", mac: "aa:bb:cc:dd:ee:ff", addrs: ["192.168.1.1/24"] }],
        subnet: "192.168.1.0/24",
        uptime: 3600,
        cpu_percent: 20,
        memory: { used_gb: 4, total_gb: 16 },
        disk: { used_gb: 100, total_gb: 512 },
        online: true,
        last_seen: Date.now(),
      }],
    }));
    await sleep(100);

    const ui = await connectWs();
    ui.send(JSON.stringify({ type: "register", role: "ui" }));
    await waitForMessage(ui);

    await drainMessage(hub);

    ui.send(JSON.stringify({ type: "command", device: "node-cmd", action: "sleep" }));

    const hubRaw = await waitForMessage(hub);
    const execMsg = JSON.parse(hubRaw);
    expect(execMsg.type).toBe("execute");
    expect(execMsg.device).toBe("node-cmd");
    expect(execMsg.action).toBe("sleep");
    expect(execMsg.mac).toBe("aa:bb:cc:dd:ee:ff");
    expect(execMsg.subnet).toBe("192.168.1.0/24");

    hub.close();
    ui.close();
  });

  it("hub disconnect clears hub flag", async () => {
    const hub = await connectWs();
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    const ui = await connectWs();
    ui.send(JSON.stringify({ type: "register", role: "ui" }));

    const init = await waitForMessage(ui);
    expect(JSON.parse(init).hub_connected).toBe(true);

    const id = env.DEVICE_HUB.idFromName("test-hub");
    hub.close();
    await sleep(500);

    let hubWsNull = false;
    await runInDurableObject(env.DEVICE_HUB.get(id), (instance) => {
      hubWsNull = (instance as Record<string, unknown>)["hubWS"] === null;
    });
    expect(hubWsNull).toBe(true);

    ui.close();
  });

  it("update with mixed online/offline devices broadcasts all", async () => {
    const id = env.DEVICE_HUB.idFromName("test-mixed-devices");
    const hub = await connectWs(id);
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    const ui = await connectWs(id);
    ui.send(JSON.stringify({ type: "register", role: "ui" }));
    await waitForMessage(ui);

    const onlineDevice = {
      hostname: "online-node",
      tailscale_ip: "100.1.2.3",
      os: "linux",
      macs: ["aa:bb:cc:dd:ee:ff"],
      interfaces: [{ name: "eth0", mac: "aa:bb:cc:dd:ee:ff", addrs: ["192.168.1.1/24"] }],
      subnet: "192.168.1.0/24",
      uptime: 3600,
      cpu_percent: 45.2,
      memory: { used_gb: 4.2, total_gb: 16 },
      disk: { used_gb: 120, total_gb: 512 },
      online: true,
      last_seen: Date.now(),
    };
    const offlineDevice = {
      hostname: "offline-node",
      tailscale_ip: "100.1.2.4",
      os: "windows",
      macs: [],
      interfaces: [],
      subnet: "",
      uptime: 0,
      cpu_percent: 0,
      memory: { used_gb: 0, total_gb: 0 },
      disk: { used_gb: 0, total_gb: 0 },
      online: false,
      last_seen: 0,
    };

    hub.send(JSON.stringify({ type: "update", devices: [onlineDevice, offlineDevice] }));

    const raw = await waitForMessage(ui);
    const stateMsg = JSON.parse(raw);
    expect(stateMsg.type).toBe("state");
    expect(stateMsg.devices).toHaveLength(2);

    const online = stateMsg.devices.find((d: { hostname: string }) => d.hostname === "online-node");
    const offline = stateMsg.devices.find((d: { hostname: string }) => d.hostname === "offline-node");

    expect(online.online).toBe(true);
    expect(online.cpu_percent).toBeCloseTo(45.2);
    expect(offline.online).toBe(false);
    expect(offline.macs).toEqual([]);

    hub.close();
    ui.close();
  });

  it("schema validation error is sent to UI clients", async () => {
    const id = env.DEVICE_HUB.idFromName("test-schema-error");
    const hub = await connectWs(id);
    hub.send(JSON.stringify({ type: "register", role: "hub" }));

    const ui = await connectWs(id);
    ui.send(JSON.stringify({ type: "register", role: "ui" }));
    await waitForMessage(ui);

    // Send update with null macs — should fail schema validation
    const brokenDevice = {
      hostname: "broken-node",
      tailscale_ip: "100.1.2.5",
      os: "linux",
      macs: null,
      interfaces: [],
      subnet: "",
      uptime: 0,
      cpu_percent: 0,
      memory: { used_gb: 0, total_gb: 0 },
      disk: { used_gb: 0, total_gb: 0 },
      online: false,
      last_seen: 0,
    };
    hub.send(JSON.stringify({ type: "update", devices: [brokenDevice] }));

    const raw = await waitForMessage(ui);
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("error");
    expect(msg.message).toContain("macs");

    hub.close();
    ui.close();
  });
});

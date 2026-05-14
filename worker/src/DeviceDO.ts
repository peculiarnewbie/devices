import { DurableObject } from "cloudflare:workers";

interface DeviceState {
  hostname: string;
  tailscale_ip: string;
  os: string;
  macs: string[];
  interfaces: { name: string; mac: string; addrs: string[] }[];
  subnet: string;
  uptime: number;
  cpu_percent: number;
  memory: { used_gb: number; total_gb: number };
  disk: { used_gb: number; total_gb: number };
  online: boolean;
  last_seen: number;
}

type WSMessage =
  | { type: "register"; role: "hub" | "ui" }
  | { type: "refresh" }
  | { type: "update"; devices: DeviceState[] }
  | { type: "command"; device: string; action: "sleep" | "shutdown" | "wake" }
  | { type: "execute"; device: string; action: "sleep" | "shutdown" | "wake"; mac?: string; subnet?: string }
  | { type: "command_result"; device: string; action: string; ok: boolean; message: string }
  | { type: "error"; device?: string; action?: string; message: string }
  | { type: "ack"; device: string; action: string }
  | { type: "state"; devices: DeviceState[] };

interface WSAttachment {
  role?: "hub" | "ui";
}

export class DeviceDO extends DurableObject {
  private devices = new Map<string, DeviceState>();
  private wsRoles = new Map<WebSocket, "hub" | "ui">();
  private hubWS: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WSAttachment | null;
      if (attachment?.role) {
        this.wsRoles.set(ws, attachment.role);
        if (attachment.role === "hub") {
          this.hubWS = ws;
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;

    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      const msg = JSON.parse(text) as WSMessage;
      this.handleMessage(ws, msg);
    } catch (e) {
      console.error("DO message error:", e);
    }
  }

  webSocketClose(ws: WebSocket) {
    this.handleClose(ws);
  }

  webSocketError(ws: WebSocket) {
    this.handleClose(ws);
  }

  private sendTo(ws: WebSocket, msg: object) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { console.error("send failed:", e); }
  }

  private sendError(ws: WebSocket, message: string, device?: string, action?: string) {
    console.warn(`error: ${message} (device=${device || "none"} action=${action || "none"})`);
    this.sendTo(ws, { type: "error", message, ...(device ? { device } : {}), ...(action ? { action } : {}) });
  }

  private handleMessage(ws: WebSocket, msg: WSMessage) {
    switch (msg.type) {
      case "register": {
        this.wsRoles.set(ws, msg.role);
        ws.serializeAttachment({ role: msg.role } satisfies WSAttachment);
        if (msg.role === "hub") {
          this.hubWS = ws;
          console.log("hub registered");
          this.broadcastState();
        } else {
          console.log("ui registered, hub:", !!this.hubWS);
          this.sendTo(ws, { type: "state", hub_connected: !!this.hubWS, devices: Array.from(this.devices.values()) });
          if (this.hubWS) {
            this.sendTo(this.hubWS, { type: "refresh" });
          }
        }
        break;
      }
      case "refresh": {
        if (!this.hubWS) {
          this.broadcastState();
          return;
        }
        this.sendTo(this.hubWS, { type: "refresh" });
        break;
      }
      case "update": {
        const role = this.wsRoles.get(ws);
        if (role !== "hub") return;
        for (const d of msg.devices) {
          const existing = this.devices.get(d.hostname);
          if (d.online) {
            d.last_seen = Date.now();
          } else {
            if (existing) {
              if (!d.subnet) d.subnet = existing.subnet;
              if (!d.macs?.length) d.macs = existing.macs;
              if (!d.interfaces?.length) d.interfaces = existing.interfaces;
              if (!d.last_seen) d.last_seen = existing.last_seen;
            }
          }
          this.devices.set(d.hostname, d);
        }
        this.broadcastState();
        break;
      }
      case "command": {
        if (!this.hubWS) {
          this.sendError(ws, "hub agent not connected", msg.device, msg.action);
          return;
        }
        const dev = this.devices.get(msg.device);
        if (!dev) {
          this.sendError(ws, `device "${msg.device}" not found`, msg.device, msg.action);
          return;
        }
        const mac = dev.macs?.[0];
        const subnet = dev.subnet;
        console.log(`command: ${msg.action} ${msg.device} mac=${mac || "none"} subnet=${subnet || "none"}`);
        try {
          this.sendTo(this.hubWS, {
            type: "execute",
            device: msg.device,
            action: msg.action,
            ...(mac ? { mac } : {}),
            ...(subnet ? { subnet } : {}),
          });
        } catch (e) {
          this.sendError(ws, `failed to forward to hub: ${e}`, msg.device, msg.action);
        }
        break;
      }
      case "command_result": {
        // Forward hub's result to all UI clients
        for (const [uiWS, role] of this.wsRoles) {
          if (role === "ui") {
            this.sendTo(uiWS, msg);
          }
        }
        break;
      }
      case "ack": {
        this.broadcastState();
        break;
      }
    }
  }

  private handleClose(ws: WebSocket) {
    const role = this.wsRoles.get(ws);
    this.wsRoles.delete(ws);
    if (role === "hub") {
      this.hubWS = null;
      this.broadcastState();
    }
  }

  private broadcastState() {
    const payload = JSON.stringify({
      type: "state",
      hub_connected: !!this.hubWS,
      devices: Array.from(this.devices.values()),
    });

    for (const [ws, role] of this.wsRoles) {
      if (role === "ui") {
        try { ws.send(payload); } catch { this.wsRoles.delete(ws); }
      }
    }
  }
}

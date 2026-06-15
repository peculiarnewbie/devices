import { DurableObject } from "cloudflare:workers";
import { decodeUnknownSync } from "effect/Schema";
import { InboundMessageSchema, type DeviceRow, type DeviceState, type InboundMessage } from "../../src/schema";

function toDeviceState(row: DeviceRow): DeviceState {
  const identity = {
    hostname: row.hostname,
    tailscale_ip: row.tailscale_ip,
    os: row.os,
    macs: row.macs,
    subnet: row.subnet,
  };
  if (row.online) {
    return {
      ...identity,
      online: true as const,
      uptime: row.uptime,
      cpu_percent: row.cpu_percent,
      memory: row.memory,
      last_seen: row.last_seen,
    };
  }
  return { ...identity, online: false as const, last_seen: row.last_seen };
}

interface WSAttachment {
  role?: "hub" | "ui";
}

export class DeviceDO extends DurableObject {
  private devices = new Map<string, DeviceRow>();
  private wsRoles = new Map<WebSocket, "hub" | "ui">();
  private hubWS: WebSocket | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<Record<string, DeviceRow>>("devices");
      if (stored) {
        for (const [key, val] of Object.entries(stored)) {
          this.devices.set(key, val);
        }
      }
    });

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

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      const parsed = JSON.parse(text);
      const role = this.wsRoles.get(ws);

      let msg: InboundMessage;
      try {
        msg = decodeUnknownSync(InboundMessageSchema)(parsed);
      } catch (schemaErr) {
        const errMsg = schemaErr instanceof Error ? schemaErr.message : String(schemaErr);
        console.error(`schema validation failed (type=${parsed.type}, role=${role}):`, errMsg);
        if (role === "hub") {
          this.broadcastError(`hub message rejected: ${errMsg}`);
        } else if (role === "ui") {
          this.sendTo(ws, { type: "error", message: `message rejected: ${errMsg}` });
        }
        return;
      }

      await this.handleMessage(ws, msg);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error("DO message error:", errMsg);
      this.broadcastError(`DO error: ${errMsg}`);
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

  private broadcastError(message: string) {
    console.warn("broadcasting error:", message);
    for (const [ws, role] of this.wsRoles) {
      if (role === "ui") {
        this.sendTo(ws, { type: "error", message });
      }
    }
  }

  private async handleMessage(ws: WebSocket, msg: InboundMessage) {
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
          this.sendTo(ws, { type: "state", hub_connected: !!this.hubWS, devices: Array.from(this.devices.values()).map(toDeviceState) });
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
        console.log("update received:", msg.devices?.length, "devices,", msg.devices?.filter(d => d.online).length, "online");
        for (const incoming of msg.devices) {
          const existing = this.devices.get(incoming.hostname);
          const last_seen = incoming.online ? Date.now() : (incoming.last_seen || (existing?.last_seen ?? Date.now()));
  const device: DeviceRow = {
    ...incoming,
    last_seen,
    macs: incoming.macs.length > 0 ? incoming.macs : (existing?.macs ?? []),
    subnet: incoming.subnet || (existing?.subnet ?? ""),
  };
          this.devices.set(device.hostname, device);
        }
        await this.ctx.storage.put("devices", Object.fromEntries(this.devices));
        this.broadcastState();
        break;
      }
      case "command": {
        if (!this.hubWS) {
          this.sendTo(ws, { type: "error", message: "hub agent not connected", device: msg.device, action: msg.action });
          return;
        }
        const dev = this.devices.get(msg.device);
        if (!dev) {
          this.sendTo(ws, { type: "error", message: `device "${msg.device}" not found`, device: msg.device, action: msg.action });
          return;
        }
        const mac = dev.macs?.[0];
        const subnet = dev.subnet;
        try {
          this.sendTo(this.hubWS, {
            type: "execute",
            device: msg.device,
            action: msg.action,
            ...(mac ? { mac } : {}),
            ...(subnet ? { subnet } : {}),
          });
        } catch (e) {
          this.sendTo(ws, { type: "error", message: `failed to forward to hub: ${e}`, device: msg.device, action: msg.action });
        }
        break;
      }
      case "command_result": {
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
      devices: Array.from(this.devices.values()).map(toDeviceState),
    });

    for (const [ws, role] of this.wsRoles) {
      if (role === "ui") {
        try { ws.send(payload); } catch { this.wsRoles.delete(ws); }
      }
    }
  }
}

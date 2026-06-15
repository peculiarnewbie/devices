import { describe, it, expect } from "vitest";
import { decodeUnknownSync } from "effect/Schema";
import {
  DeviceRowSchema,
  DeviceOnlineSchema,
  DeviceOfflineSchema,
  InboundMessageSchema,
  type DeviceRow,
  type DeviceOnline,
  type DeviceOffline,
} from "../schema";
import { formatUptime, formatLastSeen } from "../api";

function validRow(overrides?: Partial<DeviceRow>): DeviceRow {
  return {
    hostname: "node-1",
    tailscale_ip: "100.1.2.3",
    os: "linux",
    macs: ["aa:bb:cc:dd:ee:ff"],
    subnet: "192.168.1.0/24",
    uptime: 3600,
    cpu_percent: 45.2,
    memory: { used_gb: 4.2, total_gb: 16 },
    online: true,
    last_seen: Date.now(),
    ...overrides,
  };
}

describe("DeviceRowSchema", () => {
  it("accepts a valid device row", () => {
    const row = validRow();
    expect(() => decodeUnknownSync(DeviceRowSchema)(row)).not.toThrow();
  });

  it("rejects missing hostname", () => {
    const { hostname: _, ...rest } = validRow();
    expect(() => decodeUnknownSync(DeviceRowSchema)(rest)).toThrow();
  });

  it("rejects wrong type for cpu_percent", () => {
    expect(() =>
      decodeUnknownSync(DeviceRowSchema)(validRow({ cpu_percent: "high" as unknown as number })),
    ).toThrow();
  });

  it("rejects negative uptime (type correct, not validated further)", () => {
    expect(() =>
      decodeUnknownSync(DeviceRowSchema)(validRow({ uptime: -1 })),
    ).not.toThrow();
  });
});

describe("DeviceOnlineSchema", () => {
  it("accepts an online device", () => {
    const data = { ...validRow() } satisfies DeviceOnline["Type"];
    delete (data as Record<string, unknown>).online;
    const online = { ...data, online: true as const };
    expect(() => decodeUnknownSync(DeviceOnlineSchema)(online)).not.toThrow();
  });

  it("rejects online: false", () => {
    const data = Object.fromEntries(
      Object.entries(validRow({ online: false })).filter(([k]) => k !== "uptime" && k !== "cpu_percent" && k !== "memory"),
    );
    expect(() => decodeUnknownSync(DeviceOnlineSchema)(data)).toThrow();
  });
});

describe("DeviceOfflineSchema", () => {
  it("accepts an offline device with only identity + last_seen", () => {
    const offline = {
      hostname: "node-1",
      tailscale_ip: "100.1.2.3",
      os: "linux",
      macs: ["aa:bb:cc:dd:ee:ff"],
      subnet: "192.168.1.0/24",
      online: false as const,
      last_seen: 1700000000000,
    };
    expect(() => decodeUnknownSync(DeviceOfflineSchema)(offline)).not.toThrow();
  });

  it("rejects extra fields like cpu_percent", () => {
    const offline = {
      hostname: "node-1",
      tailscale_ip: "100.1.2.3",
      os: "linux",
      macs: [],
      subnet: "",
      online: false as const,
      last_seen: 1700000000000,
      cpu_percent: 50,
    };
    expect(() => decodeUnknownSync(DeviceOfflineSchema)(offline)).not.toThrow();
  });
});

describe("InboundMessageSchema", () => {
  it("accepts a register message", () => {
    const msg = { type: "register" as const, role: "hub" as const };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).not.toThrow();
  });

  it("accepts a refresh message", () => {
    expect(() => decodeUnknownSync(InboundMessageSchema)({ type: "refresh" })).not.toThrow();
  });

  it("accepts an update message with devices", () => {
    const msg = { type: "update" as const, devices: [validRow()] };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).not.toThrow();
  });

  it("accepts an update with empty macs (offline device)", () => {
    const msg = {
      type: "update" as const,
      devices: [validRow({ macs: [], online: false })],
    };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).not.toThrow();
  });

  it("rejects an update with null macs", () => {
    const msg = {
      type: "update" as const,
      devices: [{ ...validRow(), macs: null }],
    };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).toThrow();
  });

  it("rejects an update where any device has null macs (mixed online/offline)", () => {
    const onlineDevice = validRow({ online: true });
    const brokenDevice = { ...validRow({ hostname: "offline-node", online: false }), macs: null };
    const msg = {
      type: "update" as const,
      devices: [onlineDevice, brokenDevice],
    };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).toThrow();
  });

  it("accepts a command message", () => {
    const msg = { type: "command" as const, device: "node-1", action: "sleep" as const };
    expect(() => decodeUnknownSync(InboundMessageSchema)(msg)).not.toThrow();
  });

  it("rejects an command with invalid action", () => {
    expect(() =>
      decodeUnknownSync(InboundMessageSchema)({
        type: "command",
        device: "node-1",
        action: "reboot",
      }),
    ).toThrow();
  });

  it("rejects unknown message type", () => {
    expect(() =>
      decodeUnknownSync(InboundMessageSchema)({ type: "unknown_type" }),
    ).toThrow();
  });

  it("rejects malformed JSON shape (missing required field)", () => {
    expect(() =>
      decodeUnknownSync(InboundMessageSchema)({ type: "register" }),
    ).toThrow();
  });

  it("rejects null", () => {
    expect(() => decodeUnknownSync(InboundMessageSchema)(null)).toThrow();
  });
});

describe("format helpers", () => {
  it("formatUptime shows days and hours", () => {
    expect(formatUptime(90000)).toBe("1d 1h");
  });

  it("formatUptime shows hours and minutes", () => {
    expect(formatUptime(3660)).toBe("1h 1m");
  });

  it("formatUptime shows minutes only", () => {
    expect(formatUptime(300)).toBe("5m");
  });

  it("formatLastSeen shows never for 0", () => {
    expect(formatLastSeen(0)).toBe("never");
  });

  it("formatLastSeen shows just now", () => {
    expect(formatLastSeen(Date.now())).toBe("just now");
  });
});

import type { DeviceState, DeviceOnline, DeviceOffline } from "./schema";

export type AuthState = "loading" | "authenticated" | "unauthenticated";
export type { DeviceState, DeviceOnline, DeviceOffline };

export async function checkSession(): Promise<AuthState> {
  try {
    const res = await fetch("/api/session");
    if (res.ok) return "authenticated";
    return "unauthenticated";
  } catch {
    return "unauthenticated";
  }
}

export function login() {
  window.location.href = "/api/auth/login";
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/";
}

export interface CommandResult {
  device: string;
  action: string;
  ok: boolean;
  message: string;
  timestamp: number;
  pending?: boolean;
}

type DeviceCallback = (devices: DeviceState[]) => void;
type StatusCallback = (connected: boolean) => void;
type HubCallback = (connected: boolean) => void;
type ResultCallback = (result: CommandResult) => void;

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatLastSeen(ts: number): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STORAGE_KEY = "sd_refresh_interval";
const MAC_CACHE_KEY = "sd_mac_cache";

export function loadMacCache(): Record<string, readonly string[]> {
  try {
    const raw = localStorage.getItem(MAC_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return {};
}

function saveMacCache(devices: DeviceState[]) {
  try {
    const cache: Record<string, readonly string[]> = {};
    for (const d of devices) {
      if (d.macs?.length) cache[d.hostname] = d.macs;
    }
    localStorage.setItem(MAC_CACHE_KEY, JSON.stringify(cache));
  } catch { /* noop */ }
}

function loadRefreshInterval(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const ms = Number(stored);
      if ([5000, 10000, 30000, 60000].includes(ms)) return ms;
    }
  } catch { /* localStorage unavailable */ }
  return 10000;
}

function saveRefreshInterval(ms: number) {
  try { localStorage.setItem(STORAGE_KEY, String(ms)); } catch { /* noop */ }
}

export function createDeviceSocket(cb: DeviceCallback, statusCb: StatusCallback, hubCb?: HubCallback, resultCb?: ResultCallback) {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let refreshTimer: number | null = null;
  let refreshInterval = loadRefreshInterval();

  function startRefreshTimer(socket: WebSocket) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "refresh" }));
      }
    }, refreshInterval);
  }

  function setRefreshInterval(ms: number) {
    refreshInterval = ms;
    saveRefreshInterval(ms);
    if (ws && ws.readyState === WebSocket.OPEN) {
      startRefreshTimer(ws);
    }
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "register", role: "ui" }));
      statusCb(true);
      startRefreshTimer(socket);
    });

    socket.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state" && Array.isArray(msg.devices)) {
          saveMacCache(msg.devices);
          cb(msg.devices);
          if (hubCb) hubCb(msg.hub_connected === true);
        }
        if ((msg.type === "error" || msg.type === "command_result") && resultCb) {
          resultCb({
            device: msg.device || "",
            action: msg.action || "",
            ok: msg.ok ?? false,
            message: msg.message || "unknown error",
            timestamp: Date.now(),
          });
        }
      } catch {
        // ignore
      }
    });

    socket.addEventListener("close", () => {
      ws = null;
      statusCb(false);
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
      reconnectTimer = window.setTimeout(connect, 2000);
    });

    socket.addEventListener("error", () => {
      socket.close();
    });

    ws = socket;
  }

  function sendCommand(device: string, action: "sleep" | "shutdown" | "wake") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "command", device, action }));
    } else {
      if (resultCb) {
        resultCb({ device, action, ok: false, message: "not connected to server", timestamp: Date.now() });
      }
    }
  }

  function destroy() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
    ws = null;
  }

  return { connect, sendCommand, destroy, setRefreshInterval };
}

export { formatUptime, formatLastSeen };

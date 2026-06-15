import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
  createDeviceSocket,
  checkSession,
  login,
  logout,
  loadMacCache,
  type AuthState,
  type DeviceState,
  type DeviceOnline,
  type CommandResult,
} from "./api";
import DeviceCard from "./components/DeviceCard";

type SortKey = "name" | "cpu" | "memory" | "uptime";

const REFRESH_OPTIONS = [
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "60s", value: 60000 },
];

export default function App() {
  const [auth, setAuth] = createSignal<AuthState>("loading");
  const [devices, setDevices] = createSignal<DeviceState[]>([]);
  const [connected, setConnected] = createSignal(false);
  const [hubConnected, setHubConnected] = createSignal(false);
  const [sortKey, setSortKey] = createSignal<SortKey>("name");
  const savedInterval = (() => {
    try {
      const v = localStorage.getItem("sd_refresh_interval");
      if (v) {
        const ms = Number(v);
        if ([5000, 10000, 30000, 60000].includes(ms)) return ms;
      }
    } catch { /* noop */ }
    return 10000;
  })();
  const [refreshInterval, setRefreshIntervalState] = createSignal(savedInterval);
  const [toasts, setToasts] = createSignal<CommandResult[]>([]);

  function showToast(result: CommandResult) {
    setToasts((prev) => {
      const filtered = prev.filter(
        (t) => !(t.pending && t.device === result.device && t.action === result.action),
      );
      return [...filtered, result];
    });
    if (!result.pending) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.timestamp !== result.timestamp));
      }, 5000);
    }
  }

  let { connect, sendCommand, destroy, setRefreshInterval, refreshNow } = createDeviceSocket(
    (d) => setDevices(d),
    (c) => setConnected(c),
    (h) => setHubConnected(h),
    (r) => showToast(r),
  );

  onMount(async () => {
    const state = await checkSession();
    setAuth(state);
    if (state === "authenticated") {
      const cached = loadMacCache();
      if (Object.keys(cached).length > 0) {
        setDevices(
        Object.entries(cached).map(([hostname, macs]) => ({
          hostname,
          tailscale_ip: "",
          os: "",
          macs,
          subnet: "",
          online: false as const,
          last_seen: 0,
        })),
        );
      }
      connect();
    }
  });

  onCleanup(() => destroy());

  const onlineCount = () => devices().filter((d) => d.online).length;
  const offlineCount = () => devices().filter((d) => !d.online).length;

  const sorted = () => {
    const list = [...devices()];
    const key = sortKey();
    if (key === "name") list.sort((a, b) => a.hostname.localeCompare(b.hostname));
    else if (key === "cpu") list.sort((a, b) => {
      if (!a.online) return 1;
      if (!b.online) return -1;
      return b.cpu_percent - a.cpu_percent;
    });
    else if (key === "memory") list.sort((a, b) => {
      if (!a.online) return 1;
      if (!b.online) return -1;
      return b.memory.used_gb / b.memory.total_gb - a.memory.used_gb / a.memory.total_gb;
    });
    else if (key === "uptime") list.sort((a, b) => {
      if (!a.online) return 1;
      if (!b.online) return -1;
      return b.uptime - a.uptime;
    });
    return list;
  };

  return (
    <div class="min-h-screen bg-[#09090b] text-zinc-300 font-mono">
      <Show when={auth() === "loading"}>
        <div class="flex items-center justify-center min-h-screen">
          <p class="text-zinc-700 text-sm">checking session...</p>
        </div>
      </Show>

      <Show when={auth() === "unauthenticated"}>
        <div class="flex items-center justify-center min-h-screen">
          <div class="text-center">
            <h1 class="text-lg font-semibold text-zinc-100 mb-2">simple devices</h1>
            <p class="text-[11px] text-zinc-600 mb-6">sign in to manage your devices</p>
            <button
              onClick={login}
              class="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-[11px] hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              sign in with google
            </button>
          </div>
        </div>
      </Show>

      <Show when={auth() === "authenticated"}>
        <div class="w-full px-6 py-6">
          <div class="flex items-center justify-between mb-5">
            <div>
              <h1 class="text-sm font-semibold text-zinc-100 tracking-tight">simple devices</h1>
              <p class="text-[11px] text-zinc-600 mt-0.5">device state across your tailnet</p>
            </div>
            <div class="flex items-center gap-3 text-[11px]">
              <button
                onClick={logout}
                class="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
              >
                sign out
              </button>
              <div class="flex items-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full"
                  classList={{
                    "bg-emerald-400": connected(),
                    "bg-red-400": !connected(),
                  }}
                />
                <span class="text-zinc-600">{connected() ? "connected" : "reconnecting"}</span>
              </div>
              <span class="text-zinc-800">·</span>
              <span class="text-zinc-400 tabular-nums">{onlineCount()}</span>
              <span class="text-zinc-600">online</span>
              <Show when={offlineCount() > 0}>
                <span class="text-zinc-800">·</span>
                <span class="text-zinc-600 tabular-nums">{offlineCount()}</span>
                <span class="text-zinc-700">offline</span>
              </Show>
            </div>
          </div>

          <Show when={connected() && !hubConnected()}>
            <div class="mb-4 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-800/30 text-amber-400 text-[11px] flex items-center gap-2">
              <span>●</span>
              <span>hub agent not connected — data may be stale</span>
            </div>
          </Show>

          <div class="flex items-center justify-between mb-4 pb-4 border-b border-zinc-800/50">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-zinc-600">sort</span>
              <select
                value={sortKey()}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                class="bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg px-2 py-1 focus:outline-none focus:border-zinc-600 cursor-pointer appearance-none"
                style={{
                  "background-image":
                    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' fill=\'none\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%2371717a\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                  "background-repeat": "no-repeat",
                  "background-position": "right 6px center",
                  "padding-right": "22px",
                }}
              >
                <option value="name">name</option>
                <option value="cpu">cpu</option>
                <option value="memory">memory</option>
                <option value="uptime">uptime</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-zinc-600">refresh</span>
              <select
                value={refreshInterval()}
                onChange={(e) => {
                  const ms = Number(e.target.value);
                  setRefreshIntervalState(ms);
                  setRefreshInterval(ms);
                }}
                class="bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg px-2 py-1 focus:outline-none focus:border-zinc-600 cursor-pointer appearance-none"
                style={{
                  "background-image":
                    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' fill=\'none\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%2371717a\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                  "background-repeat": "no-repeat",
                  "background-position": "right 6px center",
                  "padding-right": "22px",
                }}
              >
                <For each={REFRESH_OPTIONS}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
              <button
                onClick={refreshNow}
                class="px-2 py-1 bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg hover:bg-zinc-800 hover:text-zinc-300 transition-colors cursor-pointer"
                title="refresh now"
              >
                ↻
              </button>
            </div>
          </div>

          <Show
            when={sorted().length > 0}
            fallback={
              <div class="text-center py-20 text-zinc-700">
                <p class="text-sm">no devices connected</p>
                <p class="text-[11px] mt-1">
                  make sure the hub agent is running with a websocket connection
                </p>
              </div>
            }
          >
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <For each={sorted()}>
                {(device) => (
                  <DeviceCard
                    device={device}
                    onSleep={() => sendCommand(device.hostname, "sleep")}
                    onWake={() => {
                      if (!device.macs?.length) {
                        showToast({
                          device: device.hostname,
                          action: "wake",
                          ok: false,
                          message: "no MAC address known — device may need to come online first",
                          timestamp: Date.now(),
                        });
                        return;
                      }
                      showToast({
                        device: device.hostname,
                        action: "wake",
                        ok: true,
                        message: "waking...",
                        timestamp: Date.now(),
                        pending: true,
                      });
                      sendCommand(device.hostname, "wake");
                    }}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-1.5 max-w-sm">
          <For each={toasts()}>
            {(toast) => (
              <div
                class="px-3 py-2 rounded-lg text-[11px] flex items-center gap-2 shadow-lg"
                classList={{
                  "bg-sky-900/90 border border-sky-800/40 text-sky-400": toast.pending,
                  "bg-emerald-900/90 border border-emerald-800/40 text-emerald-400": !toast.pending && toast.ok,
                  "bg-red-900/90 border border-red-800/40 text-red-400": !toast.pending && !toast.ok,
                }}
              >
                <span>{toast.pending ? "◌" : toast.ok ? "✓" : "✗"}</span>
                <span class="text-zinc-400">{toast.device}</span>
                <span class="text-zinc-600">—</span>
                <span class="truncate">{toast.message}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

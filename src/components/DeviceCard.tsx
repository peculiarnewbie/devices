import { Show } from "solid-js";
import { formatLastSeen, type DeviceState, type DeviceOnline, type DeviceOffline } from "../api";

function resourceColor(used: number, total: number): string {
  if (!total) return "text-zinc-600";
  const pct = used / total;
  if (pct > 0.9) return "text-red-400";
  if (pct > 0.7) return "text-amber-400";
  return "text-emerald-400";
}

function resourceBg(used: number, total: number): string {
  if (!total) return "bg-zinc-800";
  const pct = used / total;
  if (pct > 0.9) return "bg-red-500/40";
  if (pct > 0.7) return "bg-amber-500/40";
  return "bg-emerald-500/40";
}

function OnlineSection(props: { d: DeviceOnline; onSleep: () => void; onShutdown: () => void }) {
  return (
    <>
      <div class="space-y-1.5 mb-3">
        <div>
          <div class="flex items-center justify-between text-[10px] mb-0.5">
            <span class="text-zinc-600">CPU</span>
            <span class={resourceColor(props.d.cpu_percent, 100)}>
              {props.d.cpu_percent.toFixed(1)}%
            </span>
          </div>
          <div class="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full ${resourceBg(props.d.cpu_percent, 100)}`}
              style={{ width: `${Math.min(props.d.cpu_percent, 100)}%` }}
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-[10px] mb-0.5">
            <span class="text-zinc-600">RAM</span>
            <span class={resourceColor(props.d.memory.used_gb, props.d.memory.total_gb)}>
              {props.d.memory.used_gb.toFixed(1)} / {props.d.memory.total_gb.toFixed(0)} GB
            </span>
          </div>
          <div class="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full ${resourceBg(props.d.memory.used_gb, props.d.memory.total_gb)}`}
              style={{
                width: `${(props.d.memory.total_gb > 0 ? (props.d.memory.used_gb / props.d.memory.total_gb) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-[10px] mb-0.5">
            <span class="text-zinc-600">Disk</span>
            <span class={resourceColor(props.d.disk.used_gb, props.d.disk.total_gb)}>
              {props.d.disk.used_gb.toFixed(0)} / {props.d.disk.total_gb.toFixed(0)} GB
            </span>
          </div>
          <div class="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full ${resourceBg(props.d.disk.used_gb, props.d.disk.total_gb)}`}
              style={{
                width: `${(props.d.disk.total_gb > 0 ? (props.d.disk.used_gb / props.d.disk.total_gb) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <button
          onClick={props.onSleep}
          class="flex-1 px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded text-[10px] text-amber-400/80 transition-colors"
        >
          sleep
        </button>
        <button
          onClick={props.onShutdown}
          class="flex-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded text-[10px] text-red-400/80 transition-colors"
        >
          shutdown
        </button>
      </div>
    </>
  );
}

function OfflineSection(props: { d: DeviceOffline; onWake: () => void }) {
  return (
    <>
      <div class="flex items-center justify-between mb-3 text-[10px]">
        <span class="text-zinc-600">last seen</span>
        <span class="text-zinc-500">{formatLastSeen(props.d.last_seen)}</span>
      </div>

      <button
        onClick={props.onWake}
        class="w-full px-2 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 rounded text-[10px] text-sky-400/80 transition-colors"
      >
        wake
      </button>
    </>
  );
}

export default function DeviceCard(props: {
  device: DeviceState;
  onSleep: () => void;
  onShutdown: () => void;
  onWake: () => void;
}) {
  const d = () => props.device;

  return (
    <div
      class="border rounded-lg overflow-hidden transition-all duration-150 bg-zinc-900/60 border-zinc-800/60 hover:border-zinc-700/60"
      classList={{
        "opacity-50": !d().online,
      }}
    >
      <div class="px-3 py-2.5">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="w-2 h-2 rounded-full shrink-0 shadow-sm"
              classList={{
                "bg-emerald-400 shadow-emerald-400/20": d().online,
                "bg-red-400 shadow-red-400/20": !d().online,
              }}
            />
            <div class="min-w-0">
              <div class="text-[13px] font-medium truncate leading-tight text-zinc-200">
                {d().hostname}
              </div>
              <div class="text-[10px] text-zinc-600 truncate">{d().tailscale_ip}</div>
            </div>
          </div>
          <span class="text-[10px] text-zinc-600 shrink-0 ml-2">{d().os}</span>
        </div>

        <Show when={d().online}>
          <OnlineSection d={d() as DeviceOnline} onSleep={props.onSleep} onShutdown={props.onShutdown} />
        </Show>

        <Show when={!d().online}>
          <OfflineSection d={d() as DeviceOffline} onWake={props.onWake} />
        </Show>
      </div>
    </div>
  );
}

import {
  String, Number, Boolean,
  Struct, Array as Arr, Literal, Union,
} from "effect/Schema";

// Helper to extract the TypeScript type from a schema
type SchemaOf<S> = S extends { readonly "Type": infer T } ? T : never;

// ---- DeviceRow (internal DO storage, full flat shape) ----

export const DeviceRowSchema = Struct({
  hostname: String,
  tailscale_ip: String,
  os: String,
  macs: Arr(String),
  interfaces: Arr(
    Struct({ name: String, mac: String, addrs: Arr(String) }),
  ),
  subnet: String,
  uptime: Number,
  cpu_percent: Number,
  memory: Struct({ used_gb: Number, total_gb: Number }),
  disk: Struct({ used_gb: Number, total_gb: Number }),
  online: Boolean,
  last_seen: Number,
});
export interface DeviceRow extends SchemaOf<typeof DeviceRowSchema> {}

// ---- DeviceOnline (UI-facing, discriminated variant) ----

const DeviceIdentityFields = {
  hostname: String,
  tailscale_ip: String,
  os: String,
  macs: Arr(String),
  interfaces: Arr(
    Struct({ name: String, mac: String, addrs: Arr(String) }),
  ),
  subnet: String,
} as const;

export const DeviceOnlineSchema = Struct({
  ...DeviceIdentityFields,
  online: Literal(true),
  uptime: Number,
  cpu_percent: Number,
  memory: Struct({ used_gb: Number, total_gb: Number }),
  disk: Struct({ used_gb: Number, total_gb: Number }),
  last_seen: Number,
});
export interface DeviceOnline extends SchemaOf<typeof DeviceOnlineSchema> {}

// ---- DeviceOffline (UI-facing, discriminated variant) ----

export const DeviceOfflineSchema = Struct({
  ...DeviceIdentityFields,
  online: Literal(false),
  last_seen: Number,
});
export interface DeviceOffline extends SchemaOf<typeof DeviceOfflineSchema> {}

// ---- DeviceState (discriminated union) ----

export const DeviceStateSchema = Union([DeviceOnlineSchema, DeviceOfflineSchema]);
export type DeviceState = SchemaOf<typeof DeviceStateSchema>;

// ---- Inbound WebSocket messages (what the DO receives) ----

const RoleSchema = Union([Literal("hub"), Literal("ui")]);
const ActionSchema = Union([Literal("sleep"), Literal("shutdown"), Literal("wake")]);

const RegisterSchema = Struct({ type: Literal("register"), role: RoleSchema });
const RefreshSchema = Struct({ type: Literal("refresh") });
const UpdateSchema = Struct({ type: Literal("update"), devices: Arr(DeviceRowSchema) });
const CommandSchema = Struct({ type: Literal("command"), device: String, action: ActionSchema });
const CommandResultSchema = Struct({
  type: Literal("command_result"),
  device: String,
  action: String,
  ok: Boolean,
  message: String,
});
const AckSchema = Struct({ type: Literal("ack"), device: String, action: String });

export const InboundMessageSchema = Union([
  RegisterSchema,
  RefreshSchema,
  UpdateSchema,
  CommandSchema,
  CommandResultSchema,
  AckSchema,
]);
export type InboundMessage = SchemaOf<typeof InboundMessageSchema>;

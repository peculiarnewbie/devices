import * as Schema from "effect/Schema";

// ---- DeviceRow (internal DO storage, full flat shape) ----

export const DeviceRowSchema = Schema.Struct({
  hostname: Schema.String,
  tailscale_ip: Schema.String,
  os: Schema.String,
  macs: Schema.Array(Schema.String),
  interfaces: Schema.Array(
    Schema.Struct({ name: Schema.String, mac: Schema.String, addrs: Schema.Array(Schema.String) }),
  ),
  subnet: Schema.String,
  uptime: Schema.Number,
  cpu_percent: Schema.Number,
  memory: Schema.Struct({ used_gb: Schema.Number, total_gb: Schema.Number }),
  disk: Schema.Struct({ used_gb: Schema.Number, total_gb: Schema.Number }),
  online: Schema.Boolean,
  last_seen: Schema.Number,
});
export interface DeviceRow extends Schema.Schema.Type<typeof DeviceRowSchema> {}

// ---- DeviceOnline (UI-facing, discriminated variant) ----

const DeviceIdentityFields = {
  hostname: Schema.String,
  tailscale_ip: Schema.String,
  os: Schema.String,
  macs: Schema.Array(Schema.String),
  interfaces: Schema.Array(
    Schema.Struct({ name: Schema.String, mac: Schema.String, addrs: Schema.Array(Schema.String) }),
  ),
  subnet: Schema.String,
} as const;

export const DeviceOnlineSchema = Schema.Struct({
  ...DeviceIdentityFields,
  online: Schema.Literal(true),
  uptime: Schema.Number,
  cpu_percent: Schema.Number,
  memory: Schema.Struct({ used_gb: Schema.Number, total_gb: Schema.Number }),
  disk: Schema.Struct({ used_gb: Schema.Number, total_gb: Schema.Number }),
  last_seen: Schema.Number,
});
export interface DeviceOnline extends Schema.Schema.Type<typeof DeviceOnlineSchema> {}

// ---- DeviceOffline (UI-facing, discriminated variant) ----

export const DeviceOfflineSchema = Schema.Struct({
  ...DeviceIdentityFields,
  online: Schema.Literal(false),
  last_seen: Schema.Number,
});
export interface DeviceOffline extends Schema.Schema.Type<typeof DeviceOfflineSchema> {}

// ---- DeviceState (discriminated union) ----

export const DeviceStateSchema = Schema.Union([DeviceOnlineSchema, DeviceOfflineSchema]);
export type DeviceState = Schema.Schema.Type<typeof DeviceStateSchema>;

// ---- Inbound WebSocket messages (what the DO receives) ----

const RoleSchema = Schema.Union([Schema.Literal("hub"), Schema.Literal("ui")]);
const ActionSchema = Schema.Union([Schema.Literal("sleep"), Schema.Literal("shutdown"), Schema.Literal("wake")]);

const RegisterSchema = Schema.Struct({ type: Schema.Literal("register"), role: RoleSchema });
const RefreshSchema = Schema.Struct({ type: Schema.Literal("refresh") });
const UpdateSchema = Schema.Struct({ type: Schema.Literal("update"), devices: Schema.Array(DeviceRowSchema) });
const CommandSchema = Schema.Struct({ type: Schema.Literal("command"), device: Schema.String, action: ActionSchema });
const CommandResultSchema = Schema.Struct({
  type: Schema.Literal("command_result"),
  device: Schema.String,
  action: Schema.String,
  ok: Schema.Boolean,
  message: Schema.String,
});
const AckSchema = Schema.Struct({ type: Schema.Literal("ack"), device: Schema.String, action: Schema.String });

export const InboundMessageSchema = Schema.Union([
  RegisterSchema,
  RefreshSchema,
  UpdateSchema,
  CommandSchema,
  CommandResultSchema,
  AckSchema,
]);
export type InboundMessage = Schema.Schema.Type<typeof InboundMessageSchema>;

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "SimpleDevices",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;

    const deviceDO = Cloudflare.DurableObjectNamespace("DEVICE_HUB", {
      className: "DeviceDO",
    });

    const worker = yield* Cloudflare.Worker("DeviceWorker", {
      name: `simple-devices-${stage}`,
      main: "worker/src/index.ts",
      assets: "dist",
      compatibility: { date: "2026-05-10" },
      domain: "devices.peculiarnewbie.com",
      bindings: {
        DEVICE_HUB: deviceDO,
      },
      env: {
        APP_PUBLIC_URL: "https://devices.peculiarnewbie.com",
        AUTH_ISSUER_URL: "https://auth.peculiarnewbie.com",
        AUTH_CLIENT_ID: "simple-devices",
        OWNER_EMAIL: "peculiarnewbie@gmail.com",
      },
    });

    return { url: worker.url };
  }),
);

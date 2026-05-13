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
      bindings: {
        DEVICE_HUB: deviceDO,
      },
    });

    return { url: worker.url };
  }),
);

/// <reference types="@cloudflare/workers-types" />
export { DeviceDO } from "./DeviceDO";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.DEVICE_HUB.idFromName("hub");
      return env.DEVICE_HUB.get(id).fetch(request);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
    }
    return assetResponse;
  },
};

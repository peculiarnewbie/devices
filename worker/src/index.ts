/// <reference types="@cloudflare/workers-types" />
export { DeviceDO } from "./DeviceDO";
import { createAuthHandlers } from "./auth";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const auth = createAuthHandlers(env);

    try {
      if (pathname === "/api/auth/login" && request.method === "GET")
        return await auth.loginRedirect();
      if (pathname === "/api/auth/callback" && request.method === "GET")
        return await auth.handleCallback(request);
      if (pathname === "/api/auth/logout" && request.method === "POST")
        return auth.logout();
      if (pathname === "/api/session" && request.method === "GET")
        return await auth.sessionEndpoint(request);

      if (pathname === "/ws") {
        const hubSecret = request.headers.get("X-Hub-Secret");
        if (hubSecret !== env.HUB_SECRET) {
          await auth.requireSession(request);
        }
        const id = env.DEVICE_HUB.idFromName("hub");
        return env.DEVICE_HUB.get(id).fetch(request);
      }

      if (pathname.startsWith("/api/")) {
        return new Response("Not found", { status: 404 });
      }

      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status === 404) {
        return env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
      }
      return assetResponse;
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("unhandled error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

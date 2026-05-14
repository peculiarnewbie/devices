import type { AuthEnv } from "./auth";

declare global {
  interface Env extends AuthEnv {
    DEVICE_HUB: DurableObjectNamespace;
    ASSETS: {
      fetch(request: Request): Promise<Response>;
    };
  }
}

export {};

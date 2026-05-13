interface Env {
  DEVICE_HUB: DurableObjectNamespace;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

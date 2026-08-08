export function controlCenterHttpUrl(
  apiBase: string,
  path: string,
  deviceId: string,
  pageOrigin: string,
): string {
  const base = new URL(apiBase, pageOrigin);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(path, base);
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
    url.searchParams.set("deviceId", deviceId);
  }
  return url.toString();
}

export function controlCenterWebSocketUrl(
  apiBase: string,
  deviceId: string,
  pageOrigin: string,
): string {
  const url = new URL(controlCenterHttpUrl(apiBase, "ws", deviceId, pageOrigin));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

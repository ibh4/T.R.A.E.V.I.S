export type CameraPreviewIssue =
  | "not-configured"
  | "invalid-url"
  | "unsupported-protocol"
  | "embedded-credentials"
  | "mixed-content";

export interface CameraPreviewConfiguration {
  url: string | null;
  issue: CameraPreviewIssue | null;
  host: string | null;
}

export function resolveCameraPreviewConfiguration(
  configuredUrl: string | undefined,
  pageUrl: string,
): CameraPreviewConfiguration {
  const value = configuredUrl?.trim();
  if (!value) return { url: null, issue: "not-configured", host: null };

  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(value, page);
  } catch {
    return { url: null, issue: "invalid-url", host: null };
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { url: null, issue: "unsupported-protocol", host: null };
  }
  if (target.username || target.password) {
    return { url: null, issue: "embedded-credentials", host: target.host };
  }
  if (page.protocol === "https:" && target.protocol === "http:") {
    return { url: null, issue: "mixed-content", host: target.host };
  }
  return { url: target.toString(), issue: null, host: target.host };
}

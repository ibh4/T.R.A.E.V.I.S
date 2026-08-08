export type AuthMode = "mock" | "access";

export function resolveAuthMode(adapterMode?: string, authMode?: string, production = false): AuthMode {
  if (production) return "access";
  const normalizedAdapter = adapterMode?.toLowerCase();
  const normalizedAuth = authMode?.toLowerCase();
  if (normalizedAuth === "mock") return "mock";
  if (normalizedAuth === "access") return "access";
  return normalizedAdapter === "live" ? "access" : "mock";
}

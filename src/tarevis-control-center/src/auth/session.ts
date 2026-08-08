import {
  clearSession as clearMockSession,
  createMockSession,
  readSession as readMockSession,
  type LoginCredentials,
  type UserSession as MockUserSession,
} from "./mock-auth";
import { resolveAuthMode, type AuthMode } from "./auth-mode";

export type { AuthMode } from "./auth-mode";

export interface AccessSession {
  userId: string;
  displayName: string;
  email: string;
  mode: "access";
}

export type UserSession = MockUserSession | AccessSession;

const configuredAdapter = import.meta.env.VITE_CONTROL_CENTER_ADAPTER?.toLowerCase() ?? "mock";
const configuredAuthMode = import.meta.env.VITE_CONTROL_CENTER_AUTH_MODE?.toLowerCase();

// Live deployments are Access-protected by default; local mock previews remain frictionless.
export const authMode: AuthMode = resolveAuthMode(configuredAdapter, configuredAuthMode, import.meta.env.PROD);

const accessSession: AccessSession = {
  userId: "cloudflare-access-user",
  displayName: "ACCESS USER",
  email: "Cloudflare Access",
  mode: "access",
};

export function readSession(): UserSession | null {
  return authMode === "access" ? accessSession : readMockSession();
}

export async function createSession(credentials: LoginCredentials): Promise<UserSession> {
  if (authMode === "access") {
    throw new Error("生产环境使用 Cloudflare Access 登录，请从受保护的应用入口进入。 ");
  }
  return createMockSession(credentials);
}

export function clearSession(): void {
  if (authMode === "access") {
    window.location.assign("/cdn-cgi/access/logout");
    return;
  }
  clearMockSession();
}

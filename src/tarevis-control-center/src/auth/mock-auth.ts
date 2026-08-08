export interface UserSession {
  userId: string;
  displayName: string;
  email: string;
  mode: "mock";
}

export interface LoginCredentials {
  email: string;
  password: string;
}

const SESSION_KEY = "tarevis.control-center.mock-session";

export function readSession(): UserSession | null {
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as UserSession;
    return session.mode === "mock" && session.userId ? session : null;
  } catch {
    return null;
  }
}

export async function createMockSession(
  credentials: LoginCredentials,
): Promise<UserSession> {
  await new Promise((resolve) => window.setTimeout(resolve, 360));
  if (!credentials.email.trim() || credentials.password.length < 6) {
    throw new Error("请输入有效邮箱，密码至少需要 6 位。当前仅验证界面流程。 ");
  }

  const email = credentials.email.trim();
  const session: UserSession = {
    userId: "usr_demo_xulin",
    displayName: email.split("@")[0] || "TRAEVIS USER",
    email,
    mode: "mock",
  };
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
}

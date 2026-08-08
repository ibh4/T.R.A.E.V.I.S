import { useEffect, useState } from "react";
import type { LoginCredentials } from "./auth/mock-auth";
import {
  authMode,
  clearSession,
  createSession,
  readSession,
  type UserSession,
} from "./auth/session";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { ConsolePage } from "./pages/ConsolePage";
import { navigate, usePathname } from "./navigation";

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() => readSession());
  const pathname = usePathname();

  useEffect(() => {
    if (authMode === "access" && pathname === "/login") {
      navigate("/console/overview", true);
    } else if (authMode === "mock" && pathname.startsWith("/console") && !session) {
      navigate("/login", true);
    } else if (authMode === "mock" && pathname === "/login" && session) {
      navigate("/console/overview", true);
    }
  }, [pathname, session]);

  async function login(credentials: LoginCredentials) {
    const nextSession = await createSession(credentials);
    setSession(nextSession);
    navigate("/console/overview");
  }

  function logout() {
    clearSession();
    setSession(null);
    navigate("/");
  }

  if (authMode === "access" && pathname.startsWith("/console")) {
    return <ConsolePage session={session ?? readSession()!} onLogout={logout} />;
  }
  if (authMode === "mock" && pathname.startsWith("/console") && session) {
    return <ConsolePage session={session} onLogout={logout} />;
  }
  if (authMode === "mock" && pathname === "/login" && !session) {
    return <LoginPage onLogin={login} />;
  }
  return <LandingPage />;
}

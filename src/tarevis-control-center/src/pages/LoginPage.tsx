import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import type { LoginCredentials } from "../auth/mock-auth";
import { BrandLogo } from "../components/BrandLogo";
import { AppLink } from "../navigation";

interface LoginPageProps {
  onLogin: (credentials: LoginCredentials) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("demo@tarevis.local");
  const [password, setPassword] = useState("tarevis-demo");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin({ email, password });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请稍后重试。 ");
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-page__grid" aria-hidden="true" />
      <header className="login-header">
        <AppLink to="/" aria-label="返回首页"><BrandLogo /></AppLink>
        <AppLink className="login-back" to="/"><ArrowLeft size={15} /> 返回产品首页</AppLink>
      </header>
      <section className="login-layout" aria-labelledby="login-title">
        <div className="login-context">
          <span className="section-heading__code">SECURE ACCESS // 01</span>
          <h1 id="login-title">连接你的 T.R.A.E.V.I.S.</h1>
          <p>登录后查看家庭、设备、TRAE 与机器人状态，并处理来自各终端的事件与命令。</p>
          <div className="login-context__signal" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
          <div className="login-context__meta">
            <span>SESSION_MODE</span><strong>LOCAL MOCK</strong>
            <span>LIVE_AUTH</span><strong>PENDING</strong>
            <span>TRANSPORT</span><strong>ADAPTER READY</strong>
          </div>
        </div>
        <form className="login-form tech-panel" onSubmit={submit}>
          <div className="tech-panel__corners" aria-hidden="true" />
          <div className="login-form__heading">
            <span>USER AUTHENTICATION</span>
            <strong>账户登录</strong>
          </div>
          <label>
            <span>邮箱地址</span>
            <span className="input-shell">
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />
            </span>
          </label>
          <label>
            <span>密码</span>
            <span className="input-shell">
              <LockKeyhole size={17} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={6}
                required
              />
              <button
                className="input-shell__action"
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                title={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary login-submit" type="submit" disabled={submitting}>
            {submitting ? "建立会话中..." : "进入中控台"} <ArrowRight size={17} />
          </button>
          <p className="login-form__notice">
            当前版本仅验证前端流程，不提供真实云端身份认证或安全会话。
          </p>
        </form>
      </section>
      <footer className="login-footer">
        <span>AUTH_ADAPTER // MOCK</span>
        <span>SESSION_STORAGE // VOLATILE</span>
        <span>BUILD // 2026.07.31</span>
      </footer>
    </main>
  );
}

import {
  ArrowRight,
  BrainCircuit,
  Cloud,
  Cpu,
  Mail,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { BrandLogo, BrandMarkIcon } from "../components/BrandLogo";
import { HeroStatusField } from "../components/HeroStatusField";
import { AppLink } from "../navigation";

const capabilities = [
  {
    icon: BrainCircuit,
    index: "01",
    title: "TRAE 作为认知大脑",
    detail: "项目状态、家庭事件和用户指令进入同一个分析与建议闭环。",
  },
  {
    icon: Radar,
    index: "02",
    title: "边缘感知守护家庭",
    detail: "树莓派在本地处理视觉与音频，只上报必要的结构化事件。",
  },
  {
    icon: BrandMarkIcon,
    index: "03",
    title: "让建议进入真实世界",
    detail: "电子吧唧承接状态和操作，机器人执行受约束的硬件动作。",
  },
];

export function LandingPage() {
  return (
    <div className="site-page">
      <header className="site-header">
        <AppLink to="/" aria-label="T.R.A.E.V.I.S. 首页">
          <BrandLogo />
        </AppLink>
        <nav className="site-nav" aria-label="网站导航">
          <a href="#system">系统能力</a>
          <a href="#network">协作终端</a>
          <a href="#privacy">隐私设计</a>
        </nav>
        <div className="site-header__actions">
          <a
            className="button button--quiet site-contact"
            href="mailto:ratmal11@163.com"
            aria-label="联系我们：ratmal11@163.com"
            title="发送邮件至 ratmal11@163.com"
          >
            <Mail size={16} aria-hidden="true" />
            <span>联系我们</span>
          </a>
          <AppLink className="button button--outline site-login" to="/login">
            登录中控台 <ArrowRight size={16} />
          </AppLink>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <HeroStatusField />
          <div className="hero__edge-fade" aria-hidden="true" />
          <div className="hero__grid" aria-hidden="true" />
          <div className="hero__content">
            <h1 id="hero-title">T.R.A.E.V.I.S.</h1>
            <p className="hero__lead">把 TRAE 的智能延伸到家庭状态、实体终端与机器人行动。</p>
            <p className="hero__copy">
              一套以 TRAE 为大脑、云端中控为统一状态面、边缘节点为感知入口的多端协同系统。
            </p>
            <div className="hero__actions">
              <AppLink className="button button--primary" to="/login">
                进入我的中控台 <ArrowRight size={17} />
              </AppLink>
              <a className="button button--quiet" href="#system">
                查看系统结构
              </a>
            </div>
          </div>
          <div className="hero__telemetry" aria-label="系统能力摘要">
            <span>TRAE_CORE // ACTIVE</span>
            <span>EDGE_SENSING // LOCAL</span>
            <span>REMOTE_ACCESS // HTTPS</span>
          </div>
        </section>

        <section className="capability-band" id="system" aria-labelledby="system-title">
          <div className="section-heading">
            <span className="section-heading__code">SYSTEM / 01</span>
            <h2 id="system-title">一个状态面，连接认知、感知与行动</h2>
            <p>每个终端上报事实，中控同步状态，TRAE 给出建议，受控设备回传执行结果。</p>
          </div>
          <div className="capability-list">
            {capabilities.map(({ icon: Icon, index, title, detail }) => (
              <article className="capability-row" key={index}>
                <span className="capability-row__index">{index}</span>
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="network-band" id="network" aria-labelledby="network-title">
          <div className="network-copy">
            <span className="section-heading__code">NETWORK / 02</span>
            <h2 id="network-title">在桌面、家中和远方保持同一份状态</h2>
            <p>浏览器负责展示和操作，权威状态与消息分发由服务端承担，边缘节点保留本地感知能力。</p>
          </div>
          <div className="network-rail" aria-label="T.R.A.E.V.I.S. 协作终端">
            <div className="network-node network-node--core">
              <Cpu />
              <strong>PC + TRAE</strong>
              <span>认知与状态服务</span>
            </div>
            <span className="network-link"><i /></span>
            <div className="network-node">
              <Radar />
              <strong>HOME NODE</strong>
              <span>本地视觉与音频</span>
            </div>
            <span className="network-link"><i /></span>
            <div className="network-node">
              <BrandMarkIcon aria-hidden="true" />
              <strong>TRAE PAL</strong>
              <span>实体状态与执行入口</span>
            </div>
            <span className="network-link"><i /></span>
            <div className="network-node">
              <Cloud />
              <strong>CLOUD ACCESS</strong>
              <span>HTTPS 远程入口</span>
            </div>
          </div>
        </section>

        <section className="privacy-band" id="privacy" aria-labelledby="privacy-title">
          <ShieldCheck size={48} />
          <div>
            <span className="section-heading__code">PRIVACY / 03</span>
            <h2 id="privacy-title">感知留在边缘，控制必须有边界</h2>
          </div>
          <p>默认同步结构化事件和必要证据；公网账号、远程命令与危险动作分别鉴权、确认和审计。</p>
        </section>
      </main>

      <footer className="site-footer">
        <BrandLogo />
        <div className="site-footer__codes" aria-label="系统版本信息">
          <span>CHANNEL // CONTROL_CENTER</span>
          <span>BUILD // MOCK_FRONTEND_0.1</span>
          <span>REGION // EDGE_TO_CLOUD</span>
        </div>
        <AppLink to="/login">ACCESS CONSOLE <ArrowRight size={14} /></AppLink>
      </footer>
    </div>
  );
}

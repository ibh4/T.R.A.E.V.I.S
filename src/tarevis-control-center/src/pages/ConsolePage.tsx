import {
  BellRing,
  Bot,
  BrainCircuit,
  Cpu,
  LayoutDashboard,
  LogOut,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { UserSession } from "../auth/session";
import { BrandLogo, BrandMarkIcon } from "../components/BrandLogo";
import { ConnectionStateView } from "../components/StatusPrimitives";
import { controlCenterAdapter } from "../control/adapter";
import { formatRelativeTime, formatTime } from "../control/format";
import { getTraeConnection } from "../control/trae-semantics";
import type {
  AdapterConnectionStatus,
  CommandRecord,
  ControlCenterSnapshot,
  RobotCommandRequest,
} from "../control/types";
import { EventsView } from "../console/views/EventsView";
import { DevicesView } from "../console/views/DevicesView";
import { OverviewView } from "../console/views/OverviewView";
import { RobotView } from "../console/views/RobotView";
import { SystemView } from "../console/views/SystemView";
import { TraeView } from "../console/views/TraeView";
import { AgentView } from "../console/views/AgentView";
import { navigate, usePathname } from "../navigation";

interface ConsolePageProps {
  session: UserSession;
  onLogout: () => void;
}

type ViewId = "overview" | "events" | "devices" | "trae" | "agent" | "robot" | "system";

interface NavItem {
  id: ViewId;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ size?: number }>;
}

const navItems: NavItem[] = [
  { id: "overview", label: "总览", shortLabel: "总览", icon: LayoutDashboard },
  { id: "events", label: "家庭事件", shortLabel: "事件", icon: ShieldAlert },
  { id: "devices", label: "设备管理", shortLabel: "设备", icon: Cpu },
  { id: "trae", label: "TRAE 状态", shortLabel: "TRAE", icon: BrainCircuit },
  { id: "agent", label: "Agent 工作台", shortLabel: "Agent", icon: Bot },
  { id: "robot", label: "机器人控制", shortLabel: "机器人", icon: BrandMarkIcon },
  { id: "system", label: "系统诊断", shortLabel: "系统", icon: Settings2 },
];

function resolveView(pathname: string): ViewId {
  const candidate = pathname.split("/")[2];
  return navItems.some((item) => item.id === candidate) ? candidate as ViewId : "overview";
}

export function ConsolePage({ session, onLogout }: ConsolePageProps) {
  const pathname = usePathname();
  const view = resolveView(pathname);
  const [snapshot, setSnapshot] = useState<ControlCenterSnapshot>(() => controlCenterAdapter.getSnapshot());
  const [adapterStatus, setAdapterStatus] = useState<AdapterConnectionStatus>(() => controlCenterAdapter.getStatus());
  const [clock, setClock] = useState(() => new Date());
  const [commandInput, setCommandInput] = useState("");
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const navPulseTimerRef = useRef<number | null>(null);
  const [viewTransition, setViewTransition] = useState<{
    view: ViewId;
    direction: "up" | "down" | null;
  }>({ view, direction: null });
  const [navPulse, setNavPulse] = useState<ViewId | null>(null);

  useEffect(() => controlCenterAdapter.subscribe((nextSnapshot, nextStatus) => {
    setSnapshot(nextSnapshot);
    setAdapterStatus(nextStatus);
  }), []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (navPulseTimerRef.current !== null) window.clearTimeout(navPulseTimerRef.current);
  }, []);

  const activeAlertCount = useMemo(
    () => snapshot.events.filter((event) => event.state !== "resolved").length,
    [snapshot.events],
  );
  const coreLoad = snapshot.resources.find((resource) => resource.id === "cpu");
  const activeSlideDirection = viewTransition.view === view ? viewTransition.direction : null;

  function openView(nextView: ViewId) {
    if (nextView === view) return;

    const currentIndex = navItems.findIndex((item) => item.id === view);
    const nextIndex = navItems.findIndex((item) => item.id === nextView);
    setViewTransition({ view: nextView, direction: nextIndex > currentIndex ? "down" : "up" });
    setNavPulse(nextView);
    if (navPulseTimerRef.current !== null) window.clearTimeout(navPulseTimerRef.current);
    navPulseTimerRef.current = window.setTimeout(() => setNavPulse(null), 360);
    navigate(`/console/${nextView}`);
  }

  async function submitCommand(target: CommandRecord["target"], input: string) {
    setActionError(null);
    setActionSuccess(null);
    try {
      const commandId = await controlCenterAdapter.submitCommand({ target, input });
      if (target === "trae") setActionSuccess("TRAE 指令已进入投递队列。");
      return commandId;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "命令提交失败。");
      return "";
    }
  }

  async function submitRobotCommand(input: RobotCommandRequest) {
    setActionError(null);
    setActionSuccess(null);
    try {
      return await controlCenterAdapter.submitRobotCommand(input);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "机器人动作提交失败。");
      return "";
    }
  }

  async function emergencyStopRobot() {
    setActionError(null);
    setActionSuccess(null);
    try {
      return await controlCenterAdapter.emergencyStopRobot();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "机器人急停失败。");
      return "";
    }
  }

  async function acknowledgeEvent(eventId: string) {
    setActionError(null);
    setActionSuccess(null);
    try {
      await controlCenterAdapter.acknowledgeEvent(eventId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "事件确认失败。");
    }
  }

  async function resolveEvent(eventId: string) {
    setActionError(null);
    setActionSuccess(null);
    try {
      await controlCenterAdapter.resolveEvent(eventId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "事件解决失败。");
    }
  }

  async function resetDemo() {
    setResetting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await controlCenterAdapter.resetDemo();
      setActionSuccess("演示状态已重置，可以重新执行完整流程。");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "演示重置失败。");
    } finally {
      setResetting(false);
    }
  }

  async function submitGlobalCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commandAvailable || sending || !commandInput.trim()) return;
    setSending(true);
    try {
      const commandId = await submitCommand("trae", commandInput);
      if (commandId) setCommandInput("");
    } finally {
      setSending(false);
    }
  }

  const traeConnection = getTraeConnection(snapshot, adapterStatus);
  const commandAvailable = traeConnection === "online" && adapterStatus.canExecute;

  return (
    <div className={`console-shell ${view === "agent" ? "console-shell--agent" : ""}`}>
      <div className="scanline-overlay" aria-hidden="true" />
      <header className="console-header">
        <BrandLogo />
        <div className="console-header__status">
          <div><span>CONNECTION</span><ConnectionStateView state={snapshot.connection} /></div>
          <div><span>MODE</span><strong>{snapshot.mode.toUpperCase()} ADAPTER</strong></div>
          <div data-testid="relay-device" title={adapterStatus.deviceId}><span>DEVICE</span><strong className="relay-device-id">{adapterStatus.deviceId}</strong></div>
          <div><span>ALERTS</span><strong className={activeAlertCount ? "tone-red" : "tone-green"}>{activeAlertCount} ACTIVE</strong></div>
        </div>
        <div className="console-header__right">
          <button className="header-alert-button" type="button" title="查看待处理事件" aria-label={`查看 ${activeAlertCount} 个待处理事件`} onClick={() => openView("events")}>
            <BellRing size={18} />
            {activeAlertCount > 0 && <span>{activeAlertCount}</span>}
          </button>
          <div className="system-clock">
            <strong>{clock.toLocaleTimeString("zh-CN", { hour12: false })}</strong>
            <span>{clock.toLocaleDateString("zh-CN")} // LOCAL</span>
          </div>
          <div className="user-chip">
            <span>{session.displayName.slice(0, 2).toUpperCase()}</span>
            <div><strong>{session.displayName}</strong><small>{session.mode.toUpperCase()} SESSION</small></div>
          </div>
          <button className="icon-button header-reset-button" type="button" title={adapterStatus.canExecute ? "重置演示状态" : "本地电脑离线，无法执行"} aria-label="重置演示状态" disabled={resetting || !adapterStatus.canExecute} onClick={() => void resetDemo()}>
            <RotateCcw size={18} />
          </button>
          <button className="icon-button header-logout-button" type="button" title="退出登录" aria-label="退出登录" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <aside className="console-sidebar">
        <nav aria-label="中控台功能导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`${view === id ? "is-active" : ""}${navPulse === id ? " nav-pulse" : ""}`}
              title={label}
              aria-label={label}
              aria-current={view === id ? "page" : undefined}
              onClick={() => openView(id)}
            >
              <Icon size={23} />
              {id === "events" && activeAlertCount > 0 && <span>{activeAlertCount}</span>}
            </button>
          ))}
        </nav>
        <div className="console-sidebar__health">
          <span>CORE LOAD</span>
          <i><b style={{ height: `${coreLoad?.value ?? 0}%` }} /></i>
          <strong>{coreLoad?.displayValue ?? "--"}</strong>
        </div>
      </aside>

      <main className={`console-main${activeSlideDirection ? ` slide-${activeSlideDirection}` : ""}`} key={view}>
        {adapterStatus.phase !== "online" && (
          <div
            className={`connection-notice connection-notice--${adapterStatus.phase}`}
            role={adapterStatus.phase === "loading" ? "status" : "alert"}
            data-testid="connection-notice"
          >
            <strong>{adapterStatus.phase === "loading" ? "正在连接" : adapterStatus.phase === "protocol-error" ? "协议错误" : adapterStatus.phase === "auth-error" ? "未认证" : "后端离线"}</strong>
            <span>{adapterStatus.message}</span>
            <span className="connection-notice__meta">
              DEVICE {adapterStatus.deviceId} · REVISION {adapterStatus.revision ?? "--"} · LAST SEEN {adapterStatus.lastSeenAt ? formatRelativeTime(adapterStatus.lastSeenAt) : "--"}
            </span>
          </div>
        )}
        {actionSuccess && <div className="action-success" role="status">{actionSuccess}</div>}
        {actionError && <div className="action-error" role="alert">{actionError}</div>}
        {view === "overview" && <OverviewView snapshot={snapshot} adapterStatus={adapterStatus} onOpenEvents={() => openView("events")} />}
        {view === "events" && (
          <EventsView
            snapshot={snapshot}
            available={adapterStatus.canExecute}
            onAcknowledge={acknowledgeEvent}
            onResolve={resolveEvent}
          />
        )}
        {view === "devices" && <DevicesView snapshot={snapshot} />}
        {view === "trae" && (
          <TraeView
            snapshot={snapshot}
            onSubmit={(input) => submitCommand("trae", input)}
            available={commandAvailable}
            connection={traeConnection}
          />
        )}
        {view === "agent" && <AgentView />}
        {view === "robot" && (
          <RobotView
            snapshot={snapshot}
            available={adapterStatus.canExecute}
            onSubmit={submitRobotCommand}
            onEmergencyStop={emergencyStopRobot}
          />
        )}
        {view === "system" && <SystemView snapshot={snapshot} />}
      </main>

      {view !== "agent" && <form className="command-bar" onSubmit={submitGlobalCommand}>
        <Terminal size={17} />
        <span>CMD&gt;</span>
        <strong className="command-bar__target">TRAE</strong>
        <input
          value={commandInput}
          onChange={(event) => setCommandInput(event.target.value)}
          placeholder={commandAvailable ? "向 TRAE 提交文本任务..." : "TRAE Bridge / Adapter 不可用"}
          aria-label="TRAE 命令"
          maxLength={2_000}
          disabled={!commandAvailable}
        />
        <button
          className="icon-button"
          type="submit"
          title={commandAvailable ? "发送命令" : "TRAE Bridge / Adapter 不可用"}
          aria-label="发送命令"
          disabled={sending || !commandInput.trim() || !commandAvailable}
        >
          <Send size={18} />
        </button>
        <div className="command-bar__meta">
          <span>LAST_SYNC</span><strong>{adapterStatus.phase === "loading" ? "--:--:--" : formatTime(snapshot.lastSyncedAt)}</strong>
          <span>AUTH</span><strong>{session.mode.toUpperCase()}</strong>
        </div>
      </form>}

      <nav className="mobile-console-nav" aria-label="移动端中控台导航">
        {navItems.map(({ id, label, shortLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={view === id ? "is-active" : ""}
            title={shortLabel}
            aria-label={label}
            aria-current={view === id ? "page" : undefined}
            onClick={() => openView(id)}
          >
            <Icon size={18} /><span>{shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

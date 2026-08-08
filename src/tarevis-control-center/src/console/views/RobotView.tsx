import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BatteryMedium,
  Octagon,
  Route,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { BrandMarkIcon } from "../../components/BrandLogo";
import { CommandStatusBadge, ConnectionStateView, TechPanel } from "../../components/StatusPrimitives";
import { formatDateTime } from "../../control/format";
import type { ControlCenterSnapshot, RobotCommandRequest } from "../../control/types";

interface RobotViewProps {
  snapshot: ControlCenterSnapshot;
  available: boolean;
  onSubmit: (input: RobotCommandRequest) => Promise<string>;
  onEmergencyStop: () => Promise<string>;
}

interface RobotAction {
  id: RobotCommandRequest["action"];
  position: "forward" | "backward" | "left" | "right";
  label: string;
  description: string;
  params: RobotCommandRequest["params"];
  icon: ReactNode;
}

const actions: RobotAction[] = [
  { id: "forward", position: "forward", label: "前进", description: "机器人前进 30 厘米", params: { distanceCm: 30 }, icon: <ArrowUp /> },
  { id: "turn_left", position: "left", label: "左转", description: "机器人向左转 45 度", params: { angleDeg: 45 }, icon: <ArrowLeft /> },
  { id: "turn_right", position: "right", label: "右转", description: "机器人向右转 45 度", params: { angleDeg: 45 }, icon: <ArrowRight /> },
  { id: "backward", position: "backward", label: "后退", description: "机器人后退 20 厘米", params: { distanceCm: 20 }, icon: <ArrowDown /> },
];

export function RobotView({ snapshot, available, onSubmit, onEmergencyStop }: RobotViewProps) {
  const [pendingAction, setPendingAction] = useState<RobotAction | null>(null);
  const [sending, setSending] = useState(false);
  const robotCommands = snapshot.commands.filter((command) => command.target === "robot");
  const adapterMode = robotCommands[0]?.adapterMode ?? (snapshot.mode === "live" ? "live" : "mock");

  async function confirmAction() {
    if (!pendingAction || !available) return;
    setSending(true);
    try {
      const commandId = await onSubmit({
        action: pendingAction.id,
        params: pendingAction.params,
        confirmed: true,
      });
      if (commandId) setPendingAction(null);
    } finally {
      setSending(false);
    }
  }

  async function stopMotion() {
    if (!available) return;
    setSending(true);
    try {
      await onSubmit({ action: "stop", params: {}, confirmed: false });
    } finally {
      setSending(false);
    }
  }

  async function emergencyStop() {
    if (!available) return;
    setSending(true);
    try {
      await onEmergencyStop();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="robot-view">
      <div className="view-heading">
        <div>
          <span>ROBOT CONTROL / 机器人控制</span>
          <h1>行动执行层</h1>
        </div>
        <ConnectionStateView state={snapshot.robot.connection} />
      </div>

      {snapshot.robot.state === "offline" ? (
        <TechPanel className="module-unavailable module-unavailable--panel">
          <BrandMarkIcon size={38} />
          <h2>机器人模块未接入</h2>
          <p>当前没有机器人状态或安全控制通道。</p>
          <span className="robot-adapter-mode">{adapterMode.toUpperCase()} ROBOT ADAPTER / OFFLINE</span>
        </TechPanel>
      ) : <>
        <div className="robot-layout">
        <TechPanel className="robot-status-panel">
          <div className="panel-heading">
            <div><span>ROBOT / 01</span><strong>蜘蛛机器人</strong></div>
            <BrandMarkIcon size={20} />
          </div>
          <div className={`robot-avatar robot-avatar--${snapshot.robot.state}`}>
            <div className="robot-avatar__core"><BrandMarkIcon className="robot-avatar__mark" /></div>
            <i /><i /><i /><i />
          </div>
          <div className="robot-current-state">
            <strong>{snapshot.robot.label}</strong>
            <p>{snapshot.robot.task}</p>
          </div>
          <div className="robot-metrics">
            <div><BatteryMedium size={17} /><span>BATTERY</span><strong>{snapshot.robot.battery}%</strong></div>
            <div><Route size={17} /><span>QUEUE</span><strong>{robotCommands.filter((command) => ["requested", "accepted", "running"].includes(command.status)).length}</strong></div>
          </div>
        </TechPanel>

        <TechPanel className="robot-control-panel">
          <div className="panel-heading">
            <div><span>MANUAL OVERRIDE</span><strong>受控动作</strong></div>
            <ShieldAlert size={18} />
          </div>
          <div className="direction-pad" aria-label="机器人方向控制">
            {actions.map((action) => (
              <button
                key={action.id}
                className={`direction-pad__${action.position}`}
                type="button"
                title={action.label}
                aria-label={action.label}
                onClick={() => setPendingAction(action)}
                disabled={sending || !available}
              >
                {action.icon}
              </button>
            ))}
            <button
              className="direction-pad__center"
              type="button"
              title="停止"
              aria-label="停止"
              onClick={stopMotion}
              disabled={sending || !available}
            >
              <Octagon />
            </button>
          </div>
          <div className="robot-secondary-actions">
            <button type="button" disabled={!available} onClick={() => setPendingAction({ id: "patrol", position: "forward", label: "巡逻", description: "开始安全区域巡逻", params: {}, icon: <Route /> })}>
              <Route size={16} /> 区域巡逻
            </button>
            <button type="button" disabled={!available} onClick={() => setPendingAction({ id: "return_home", position: "backward", label: "归位", description: "返回安全待命点", params: {}, icon: <RotateCcw /> })}>
              <RotateCcw size={16} /> 返回待命点
            </button>
          </div>
          <button className="emergency-stop" type="button" onClick={emergencyStop} disabled={sending || !available}>
            <Octagon size={18} /> 紧急停止
          </button>
          <span className="robot-adapter-mode">{adapterMode.toUpperCase()} ROBOT ADAPTER</span>
          <p className="robot-safety-copy">{available ? "移动命令必须经过二次确认。" : "本地电脑离线，远程控制已锁定。"}</p>
        </TechPanel>
        </div>

        <TechPanel className="command-history-panel">
          <div className="panel-heading">
            <div><span>EXECUTION LOG</span><strong>动作回执</strong></div>
            <span>{robotCommands.length} ITEMS</span>
          </div>
          <div className="command-history">
            {robotCommands.map((command) => (
              <article key={command.commandId}>
                <time>{formatDateTime(command.requestedAt)}</time>
                <code>{command.commandId}</code>
                <div className="command-history__content">
                  <p>{command.input}</p>
                  {command.result && <small>{command.result}</small>}
                </div>
                <CommandStatusBadge status={command.status} />
              </article>
            ))}
          </div>
        </TechPanel>

        {pendingAction && (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => !sending && setPendingAction(null)}>
            <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="robot-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
              <button className="icon-button confirm-modal__close" type="button" aria-label="关闭确认" title="关闭" onClick={() => setPendingAction(null)} disabled={sending}>
                <X size={18} />
              </button>
              <ShieldAlert size={30} />
              <span>REMOTE ACTION CONFIRMATION</span>
              <h2 id="robot-confirm-title">确认发送“{pendingAction.label}”命令？</h2>
              <p>{pendingAction.description}</p>
              <div className="confirm-modal__actions">
                <button className="button button--quiet" type="button" onClick={() => setPendingAction(null)} disabled={sending}>取消</button>
                <button className="button button--primary" type="button" onClick={confirmAction} disabled={sending || !available}>
                  {sending ? "发送中..." : "确认发送"}
                </button>
              </div>
            </section>
          </div>
        )}
      </>}
    </div>
  );
}

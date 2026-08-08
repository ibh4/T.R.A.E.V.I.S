import { BrainCircuit, CheckCircle2, Circle, CircleAlert, LoaderCircle, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { CommandStatusBadge, TechPanel } from "../../components/StatusPrimitives";
import { formatDateTime, formatRelativeTime } from "../../control/format";
import {
  getTraeAdapterMode,
  traeCommandResultText,
  traeCommandStatusLabel,
  traeSnapshotLabel,
} from "../../control/trae-semantics";
import type { CommandRecord, CommandStatus, ConnectionState, ControlCenterSnapshot } from "../../control/types";

interface TraeViewProps {
  snapshot: ControlCenterSnapshot;
  onSubmit: (input: string) => Promise<string>;
  available: boolean;
  connection: ConnectionState;
}

export function TraeView({ snapshot, onSubmit, available, connection }: TraeViewProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const traeCommands = snapshot.commands.filter((command) => command.target === "trae");
  const latestCommand = traeCommands[0];
  const adapterMode = getTraeAdapterMode(snapshot);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || sending || !input.trim()) return;
    setSending(true);
    try {
      const commandId = await onSubmit(input);
      if (commandId) setInput("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="trae-view">
      <div className="view-heading">
        <div>
          <span>TRAE STATUS / 核心状态</span>
          <h1>认知大脑</h1>
        </div>
        <div className={`trae-state trae-state--${snapshot.trae.state}`}>
          <BrainCircuit size={19} />
          <span>{traeSnapshotLabel(snapshot)}</span>
        </div>
      </div>

      {!available && (
        <TechPanel className={`module-unavailable trae-unavailable-panel trae-unavailable-panel--${connection}`}>
          <BrainCircuit size={32} />
          <h2>{connection === "degraded" ? "TRAE Bridge 当前受限" : "TRAE Bridge / Adapter 不可用"}</h2>
          <p>{connection === "degraded"
            ? "Bridge 已响应，但 TRAE 当前不可操作，命令入口已停用。"
            : "当前无法使用 TRAE 命令通道，恢复连接后可继续提交。"}</p>
        </TechPanel>
      )}

      <div className="trae-layout">
        <TechPanel className="trae-task-panel">
          <div className="panel-heading">
            <div><span>ACTIVE PROJECT</span><strong>{snapshot.trae.project}</strong></div>
            <span>{snapshot.trae.progress}%</span>
          </div>
          <h2>{snapshot.trae.task}</h2>
          <div className="progress-track" aria-label={`TRAE 指令投递进度 ${snapshot.trae.progress}%`}>
            <i style={{ width: `${snapshot.trae.progress}%` }} />
          </div>
          <div className="task-stages">
            <TaskStage state={stageState(latestCommand?.status, 0)} label="已请求" detail="REQUESTED" />
            <TaskStage state={stageState(latestCommand?.status, 1)} label="本地队列" detail="ACCEPTED" />
            <TaskStage state={stageState(latestCommand?.status, 2)} label="投递 / 等待" detail="RUNNING" />
            <TaskStage
              state={stageState(latestCommand?.status, 3)}
              label={terminalStageLabel(latestCommand)}
              detail={terminalStageDetail(latestCommand?.status)}
            />
          </div>
          <div className="trae-suggestion">
            <span>TRAE SUGGESTION</span>
            <p>{snapshot.trae.suggestion}</p>
          </div>
          <span className="panel-timestamp">更新于 {formatRelativeTime(snapshot.trae.updatedAt)}</span>
        </TechPanel>

        <TechPanel className="trae-command-panel">
          <div className="panel-heading">
            <div><span>COMMAND INPUT</span><strong>向 TRAE 发出指令</strong></div>
            <Send size={17} />
          </div>
          <form className="trae-command-form" onSubmit={submit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="描述你希望 TRAE 分析或推进的任务..."
              maxLength={2_000}
              rows={5}
              disabled={!available || sending}
            />
            <button className="button button--primary" type="submit" disabled={!available || sending || !input.trim()}>
              <Send size={16} /> {!available ? "Bridge 不可用" : sending ? "发送中..." : "提交给 TRAE"}
            </button>
          </form>
          <div className="adapter-boundary-note">
            <strong>{adapterMode.toUpperCase()} TRAE ADAPTER</strong>
            <p>{adapterMode === "mock" ? "命令由 MockTraeAdapter 执行。" : "命令由 LiveTraeAdapter 执行。"}</p>
          </div>
        </TechPanel>
        </div>

        <TechPanel className="command-history-panel">
          <div className="panel-heading">
            <div><span>COMMAND QUEUE</span><strong>TRAE 命令记录</strong></div>
            <span>{traeCommands.length} ITEMS</span>
          </div>
          <div className="command-history">
            {traeCommands.map((command) => {
              const resultText = traeCommandResultText(command);
              return (
                <article key={command.commandId}>
                  <time>{formatDateTime(command.requestedAt)}</time>
                  <code>{command.commandId}</code>
                  <div className="command-history__content">
                    <p>{command.input}</p>
                    <small title={resultText}>{resultText}</small>
                  </div>
                  <CommandStatusBadge status={command.status} label={traeCommandStatusLabel(command)} />
                </article>
              );
            })}
            {traeCommands.length === 0 && <p className="empty-state">尚无 TRAE 命令记录。</p>}
          </div>
        </TechPanel>
    </div>
  );
}

type TaskStageState = "done" | "active" | "pending" | "error";

function stageState(status: CommandStatus | undefined, index: number): TaskStageState {
  if (!status) return "pending";
  const currentIndex: Record<CommandStatus, number> = {
    requested: 0,
    accepted: 1,
    running: 2,
    succeeded: 3,
    failed: 3,
    expired: 3,
  };
  if (index === 3 && (status === "failed" || status === "expired")) return "error";
  if (index < currentIndex[status] || (index === 3 && status === "succeeded")) return "done";
  if (index === currentIndex[status]) return "active";
  return "pending";
}

function terminalStageLabel(command: CommandRecord | undefined): string {
  return command ? traeCommandStatusLabel(command) : "结果回执";
}

function terminalStageDetail(status: CommandStatus | undefined): string {
  if (status === "succeeded") return "DELIVERY RESULT";
  if (status === "failed") return "SEND FAILED";
  if (status === "expired") return "RESULT UNKNOWN";
  return "TERMINAL";
}

function TaskStage({ state, label, detail }: { state: TaskStageState; label: string; detail: string }) {
  const Icon = state === "done"
    ? CheckCircle2
    : state === "active"
      ? LoaderCircle
      : state === "error"
        ? CircleAlert
        : Circle;
  return (
    <div className={`task-stage task-stage--${state}`}>
      <Icon size={17} />
      <span><strong>{label}</strong><small>{detail}</small></span>
    </div>
  );
}

import { Activity, BrainCircuit, ChevronRight, Home, Radio } from "lucide-react";
import { BrandMarkIcon } from "../../components/BrandLogo";
import {
  ConnectionStateView,
  ResourceBars,
  SeverityBadge,
  TechPanel,
} from "../../components/StatusPrimitives";
import { formatRelativeTime, formatTime } from "../../control/format";
import { getTraeConnection, traeSnapshotLabel } from "../../control/trae-semantics";
import type { AdapterConnectionStatus, ControlCenterSnapshot } from "../../control/types";

interface OverviewViewProps {
  snapshot: ControlCenterSnapshot;
  adapterStatus: AdapterConnectionStatus;
  onOpenEvents: () => void;
}

export function OverviewView({ snapshot, adapterStatus, onOpenEvents }: OverviewViewProps) {
  const primaryEvent = snapshot.events.find((event) => event.state !== "resolved") ?? snapshot.events[0];
  const traeConnection = getTraeConnection(snapshot);

  return (
    <div className="overview-view">
      <div className="view-heading">
        <div>
          <span>OVERVIEW / 总览界面</span>
          <h1>设备状态</h1>
        </div>
        <div className="view-heading__sync">
          <ConnectionStateView state={snapshot.connection} />
          <span>更新于 {formatRelativeTime(snapshot.lastSyncedAt)}</span>
          <span data-testid="relay-revision">REVISION {adapterStatus.revision ?? "--"}</span>
          <span data-testid="relay-last-seen">LAST SEEN {adapterStatus.lastSeenAt ? formatRelativeTime(adapterStatus.lastSeenAt) : "--"}</span>
        </div>
      </div>

      <div className="overview-main-grid">
        <TechPanel className="home-visual-panel">
          <div className="panel-heading panel-heading--overlay">
            <div>
              <span>HOME STATE / 01</span>
              <strong>{snapshot.home.activeZone}</strong>
            </div>
            <span className={`home-state home-state--${snapshot.home.state}`}>{snapshot.home.label}</span>
          </div>
          <div className="home-visual" aria-label={`家庭状态：${snapshot.home.label}`}>
            <div className="home-visual__orbit home-visual__orbit--outer" />
            <div className="home-visual__orbit home-visual__orbit--inner" />
            <div className="home-visual__scan" />
            <div className="home-visual__avatar">
              <BrandMarkIcon className="home-visual__brand-mark" data-testid="overview-brand-mark" />
            </div>
            <span className="home-visual__axis home-visual__axis--x">ZONE_X // {snapshot.home.state === "unavailable" ? "UNAVAILABLE" : "112.04"}</span>
            <span className="home-visual__axis home-visual__axis--y">ZONE_Y // {snapshot.home.state === "unavailable" ? "UNAVAILABLE" : "-42.81"}</span>
          </div>
          <div className="home-visual-panel__footer">
            <div>
              <span>CURRENT SUMMARY</span>
              <strong>{snapshot.home.summary}</strong>
            </div>
            <button className="icon-text-button" type="button" onClick={onOpenEvents}>
              查看事件 <ChevronRight size={15} />
            </button>
          </div>
        </TechPanel>

        <div className="overview-side-stack">
          <TechPanel className="resource-panel">
            <div className="panel-heading">
              <div>
                <span>RESOURCE ALLOCATION</span>
                <strong>系统资源</strong>
              </div>
              <Activity size={18} />
            </div>
            <div className="resource-list">
              {snapshot.resources.map((metric) => (
                <div className="resource-item" key={metric.id}>
                  <div>
                    <span>{metric.label}</span>
                    <strong className={`tone-${metric.tone}`}>{metric.displayValue}</strong>
                  </div>
                  <ResourceBars metric={metric} />
                </div>
              ))}
              {snapshot.resources.length === 0 && <p className="empty-state">诊断模块未接入。</p>}
            </div>
          </TechPanel>

          <TechPanel className="event-stream-panel">
            <div className="panel-heading">
              <div>
                <span>EVENT STREAM</span>
                <strong>实时事件</strong>
              </div>
              <Radio size={17} />
            </div>
            <div className="event-stream">
              {snapshot.events.slice(0, 4).map((event) => (
                <button className="event-stream__row" type="button" onClick={onOpenEvents} key={event.eventId}>
                  <time>{formatTime(event.occurredAt)}</time>
                  <SeverityBadge level={event.level} />
                  <span>{event.title}</span>
                </button>
              ))}
              {snapshot.events.length === 0 && <p className="empty-state">事件模块未接入。</p>}
            </div>
          </TechPanel>
        </div>
      </div>

      <div className="system-summary-strip">
        <SummaryCell
          icon={<Home />}
          label="HOME"
          value={snapshot.home.label}
          detail={snapshot.home.state === "unavailable" ? "家庭事件模块未接入" : `${snapshot.events.filter((event) => event.state !== "resolved").length} 个待处理事件`}
          tone={snapshot.home.state === "normal" ? "green" : snapshot.home.state === "unavailable" ? "yellow" : "red"}
        />
        <SummaryCell
          icon={<BrainCircuit />}
          label="TRAE"
          value={traeSnapshotLabel(snapshot)}
          detail={traeConnection === "online" ? snapshot.trae.project : "TRAE Bridge / Adapter 不可用"}
          tone={traeConnection === "online" ? "cyan" : "yellow"}
        />
        <SummaryCell
          icon={<Radio />}
          label="DEVICES"
          value={`${snapshot.devices.filter((device) => device.connection === "online").length} / ${snapshot.devices.length} 在线`}
          detail={snapshot.devices.length === 0 ? "设备模块未接入" : "边缘终端与执行层"}
          tone="yellow"
        />
        <SummaryCell
          icon={<BrandMarkIcon size={22} />}
          label="ROBOT"
          value={snapshot.robot.label}
          detail={snapshot.robot.state === "offline" ? "机器人模块未接入" : `${snapshot.robot.battery}% 电量`}
          tone={snapshot.robot.state === "offline" ? "yellow" : "green"}
        />
      </div>

      {primaryEvent && (
        <TechPanel className={`priority-event priority-event--${primaryEvent.level}`}>
          <div>
            <SeverityBadge level={primaryEvent.level} />
            <span>HIGHEST PRIORITY / {primaryEvent.eventId}</span>
          </div>
          <strong>{primaryEvent.title}</strong>
          <p>{primaryEvent.summary}</p>
          <button className="icon-text-button" type="button" onClick={onOpenEvents}>
            进入处理 <ChevronRight size={15} />
          </button>
        </TechPanel>
      )}
    </div>
  );
}

interface SummaryCellProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "cyan" | "yellow" | "red";
}

function SummaryCell({ icon, label, value, detail, tone }: SummaryCellProps) {
  return (
    <article className={`summary-cell summary-cell--${tone}`}>
      <span className="summary-cell__icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

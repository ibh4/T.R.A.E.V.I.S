import { Check, CheckCircle2, ChevronRight, Filter, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { SeverityBadge, TechPanel } from "../../components/StatusPrimitives";
import { formatDateTime, formatRelativeTime } from "../../control/format";
import type { ControlCenterSnapshot, EventState, Severity } from "../../control/types";

type EventFilter = "all" | Severity | "pending";

interface EventsViewProps {
  snapshot: ControlCenterSnapshot;
  available: boolean;
  onAcknowledge: (eventId: string) => Promise<void>;
  onResolve: (eventId: string) => Promise<void>;
}

const stateLabels: Record<EventState, string> = {
  detected: "待确认",
  acknowledged: "已确认待解决",
  resolved: "已关闭",
  escalated: "已升级",
};
const resolvableStates = new Set<EventState>(["acknowledged", "escalated"]);

const filters: Array<{ id: EventFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "pending", label: "待处理" },
  { id: "critical", label: "紧急" },
  { id: "warning", label: "注意" },
  { id: "info", label: "信息" },
];

export function EventsView({ snapshot, available, onAcknowledge, onResolve }: EventsViewProps) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [selectedId, setSelectedId] = useState(snapshot.events[0]?.eventId ?? "");
  const [pendingAction, setPendingAction] = useState<"ack" | "resolve" | null>(null);

  const filteredEvents = useMemo(
    () => snapshot.events.filter((event) => {
      if (filter === "all") return true;
      if (filter === "pending") return event.state !== "resolved";
      return event.level === filter;
    }),
    [filter, snapshot.events],
  );
  const selectedEvent = filteredEvents.find((event) => event.eventId === selectedId) ?? filteredEvents[0];

  async function runAction(action: "ack" | "resolve") {
    if (!selectedEvent || !available) return;
    setPendingAction(action);
    try {
      await (action === "ack"
        ? onAcknowledge(selectedEvent.eventId)
        : onResolve(selectedEvent.eventId));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="events-view">
      <div className="view-heading">
        <div>
          <span>HOME EVENTS / 家庭事件</span>
          <h1>事件与确认</h1>
        </div>
        <div className="event-counts">
          <strong>{snapshot.events.filter((event) => event.state !== "resolved").length}</strong>
          <span>待处理 / {snapshot.events.length} 总计</span>
        </div>
      </div>

      <div className="event-filter-bar" aria-label="事件筛选">
        <Filter size={15} />
        <div className="segmented-control">
          {filters.map((item) => (
            <button
              type="button"
              className={filter === item.id ? "is-active" : ""}
              onClick={() => setFilter(item.id)}
              key={item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="events-layout">
        <TechPanel className="event-table-panel">
          <div className="event-table event-table--header" aria-hidden="true">
            <span>时间</span><span>等级</span><span>来源</span><span>事件</span><span>状态</span>
          </div>
          <div className="event-table-body">
            {filteredEvents.map((event) => (
              <button
                type="button"
                className={`event-table ${selectedEvent?.eventId === event.eventId ? "is-selected" : ""}`}
                onClick={() => setSelectedId(event.eventId)}
                key={event.eventId}
              >
                <time>{formatDateTime(event.occurredAt)}</time>
                <SeverityBadge level={event.level} />
                <span className="event-source">{event.source.toUpperCase()}</span>
                <span className="event-title-cell"><strong>{event.title}</strong><small>{event.zone}</small></span>
                <span className={`event-state event-state--${event.state}`}>
                  {stateLabels[event.state]}
                </span>
                <ChevronRight className="event-row-chevron" size={15} />
              </button>
            ))}
            {filteredEvents.length === 0 && (
              <p className="empty-state">{snapshot.events.length === 0 ? "事件模块未接入。" : "当前筛选条件下没有事件。"}</p>
            )}
          </div>
        </TechPanel>

        {selectedEvent && (
          <TechPanel className={`event-detail-panel event-detail-panel--${selectedEvent.level}`}>
            <div className="panel-heading">
              <div>
                <span>EVENT DETAIL</span>
                <strong>{selectedEvent.eventId}</strong>
              </div>
              <ShieldAlert size={19} />
            </div>
            <SeverityBadge level={selectedEvent.level} />
            <h2>{selectedEvent.title}</h2>
            <p>{selectedEvent.summary}</p>
            <dl className="detail-list">
              <div><dt>设备</dt><dd>{selectedEvent.deviceId}</dd></div>
              <div><dt>区域</dt><dd>{selectedEvent.zone}</dd></div>
              <div><dt>状态</dt><dd>{stateLabels[selectedEvent.state]}</dd></div>
              <div><dt>数据源</dt><dd>{selectedEvent.adapterMode.toUpperCase()}</dd></div>
              <div><dt>发生时间</dt><dd>{formatDateTime(selectedEvent.occurredAt)} · {formatRelativeTime(selectedEvent.occurredAt)}</dd></div>
              <div><dt>置信度</dt><dd>{selectedEvent.confidence !== undefined ? `${Math.round(selectedEvent.confidence * 100)}%` : "--"}</dd></div>
              {selectedEvent.acknowledgedAt && (
                <div><dt>确认</dt><dd>{selectedEvent.acknowledgedBy} · {formatDateTime(selectedEvent.acknowledgedAt)}</dd></div>
              )}
              {selectedEvent.resolvedAt && (
                <div><dt>解决</dt><dd>{selectedEvent.resolvedBy} · {formatDateTime(selectedEvent.resolvedAt)}</dd></div>
              )}
            </dl>
            <div className="payload-view">
              <span>STRUCTURED PAYLOAD</span>
              <code>{JSON.stringify(selectedEvent.payload, null, 2)}</code>
            </div>
            <div className="event-actions">
              <button
                className="button button--outline"
                type="button"
                onClick={() => runAction("ack")}
                disabled={!available || selectedEvent.state !== "detected" || pendingAction !== null}
              >
                <Check size={17} />
                {pendingAction === "ack"
                  ? "同步确认中..."
                  : selectedEvent.state === "detected"
                    ? "确认已查看"
                    : selectedEvent.state === "escalated"
                      ? "事件已升级"
                      : selectedEvent.state === "resolved"
                        ? "事件已关闭"
                        : "事件已确认"}
              </button>
              <button
                className={`button ${resolvableStates.has(selectedEvent.state) ? "button--primary" : "button--outline"}`}
                type="button"
                onClick={() => runAction("resolve")}
                disabled={!available || !resolvableStates.has(selectedEvent.state) || pendingAction !== null}
              >
                <CheckCircle2 size={17} />
                {pendingAction === "resolve" ? "同步解决中..." : selectedEvent.state === "resolved" ? "事件已解决" : "解决事件"}
              </button>
            </div>
          </TechPanel>
        )}
      </div>
    </div>
  );
}

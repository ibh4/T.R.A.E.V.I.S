import type { HTMLAttributes, ReactNode } from "react";
import { commandStatusLabels, connectionLabels, severityLabels } from "../control/format";
import type {
  CommandStatus,
  ConnectionState,
  ResourceMetric,
  Severity,
} from "../control/types";

export function ConnectionStateView({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection-state connection-state--${state}`}>
      <i aria-hidden="true" /> {connectionLabels[state]}
    </span>
  );
}

export function SeverityBadge({ level }: { level: Severity }) {
  return <span className={`severity severity--${level}`}>{severityLabels[level]}</span>;
}

export function CommandStatusBadge({ status, label }: { status: CommandStatus; label?: string }) {
  return <span className={`command-status command-status--${status}`}>{label ?? commandStatusLabels[status]}</span>;
}

interface TechPanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: "article" | "section" | "div";
}

export function TechPanel({ children, className = "", as = "section", ...props }: TechPanelProps) {
  const Component = as;
  return (
    <Component className={`tech-panel console-panel ${className}`} {...props}>
      <span className="tech-panel__corners" aria-hidden="true" />
      {children}
    </Component>
  );
}

export function ResourceBars({ metric }: { metric: ResourceMetric }) {
  return (
    <div className={`resource-bars resource-bars--${metric.tone}`} aria-label={`${metric.label} ${metric.displayValue}`}>
      {metric.history.map((value, index) => (
        <i key={`${metric.id}-${index}`} style={{ height: `${Math.max(14, value)}%` }} />
      ))}
    </div>
  );
}

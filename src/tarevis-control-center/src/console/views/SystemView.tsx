import { Cloud, Database, Network, Server, ShieldCheck, Wifi } from "lucide-react";
import { ConnectionStateView, ResourceBars, TechPanel } from "../../components/StatusPrimitives";
import type { ControlCenterSnapshot } from "../../control/types";

export function SystemView({ snapshot }: { snapshot: ControlCenterSnapshot }) {
  const backendCore = snapshot.services.find((service) => service.serviceId === "backend-core");
  const eventsModule = snapshot.services.find((service) => service.serviceId === "events-module");

  return (
    <div className="system-view">
      <div className="view-heading">
        <div>
          <span>DIAGNOSTICS / 系统诊断</span>
          <h1>服务与网络</h1>
        </div>
        <span className="environment-label">ENV // {snapshot.mode.toUpperCase()}</span>
      </div>

      <div className="system-layout">
        <TechPanel className="service-panel">
          <div className="panel-heading">
            <div><span>SERVICE MATRIX</span><strong>核心服务</strong></div>
            <Server size={18} />
          </div>
          <div className="service-list">
            {snapshot.services.map((service) => (
              <article key={service.serviceId} data-service-id={service.serviceId}>
                <ConnectionStateView state={service.connection} />
                <div><strong>{service.name}</strong><code>{service.serviceId}</code></div>
                <span className="service-version">
                  {service.version}
                  <small className={`adapter-mode-tag adapter-mode-tag--${service.adapterMode}`}>
                    {service.adapterMode.toUpperCase()}
                  </small>
                </span>
                <span>{service.latency}</span>
                <p>{service.detail}</p>
              </article>
            ))}
            {snapshot.services.length === 0 && <p className="empty-state">诊断服务模块未接入。</p>}
          </div>
        </TechPanel>

        <TechPanel className="diagnostic-panel">
          <div className="panel-heading">
            <div><span>RESOURCES USE</span><strong>资源占用</strong></div>
            <Database size={18} />
          </div>
          <div className="diagnostic-metrics">
            {snapshot.resources.map((metric) => (
              <div key={metric.id} data-resource-id={metric.id}>
                <span>{metric.label}</span>
                <strong className={`tone-${metric.tone}`}>{metric.displayValue}</strong>
                <ResourceBars metric={metric} />
              </div>
            ))}
            {snapshot.resources.length === 0 && <p className="empty-state">资源指标尚不可用。</p>}
          </div>
        </TechPanel>
      </div>

      <div className="topology-strip" aria-label="系统连接边界">
        <TopologyNode
          icon={<Wifi />}
          title="HOME EDGE"
          detail="感知与结构化事件"
          status={serviceStatus(eventsModule)}
        />
        <span className="topology-link">STRUCTURED EVENTS</span>
        <TopologyNode
          icon={<Server />}
          title="PC STATE SERVICE"
          detail="权威状态与消息分发"
          status={serviceStatus(backendCore)}
        />
        <span className="topology-link">HTTPS / WSS</span>
        <TopologyNode icon={<Cloud />} title="PUBLIC EDGE" detail="外部部署边界" status="EXTERNAL" />
      </div>

      <TechPanel className="security-boundary-panel">
        <ShieldCheck size={24} />
        <div>
          <span>SECURITY BOUNDARY</span>
          <strong>云端页面不直接访问 USB、串口、模型或家庭局域网设备</strong>
        </div>
        <p>远程用户只通过经过认证的状态服务读取状态或提交命令；设备身份、权限、回执和审计由后端负责。</p>
        <Network size={24} />
      </TechPanel>
    </div>
  );
}

function serviceStatus(service: ControlCenterSnapshot["services"][number] | undefined): string {
  return service
    ? `${service.connection.toUpperCase()} / ${service.adapterMode.toUpperCase()}`
    : "UNAVAILABLE";
}

function TopologyNode({ icon, title, detail, status }: { icon: React.ReactNode; title: string; detail: string; status: string }) {
  return (
    <article className="topology-node">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
      <code>{status}</code>
    </article>
  );
}

import { Camera, Cpu, Mic, MonitorCog, Radio, Settings2, X } from "lucide-react";
import { useState, type ComponentType } from "react";
import { BrandMarkIcon } from "../../components/BrandLogo";
import { ConnectionStateView, TechPanel } from "../../components/StatusPrimitives";
import { formatRelativeTime } from "../../control/format";
import type { ControlCenterSnapshot, DeviceStatus } from "../../control/types";
import { CameraPreviewPanel } from "../components/CameraPreviewPanel";

const deviceIcons: Record<DeviceStatus["kind"], ComponentType<{ size?: number }>> = {
  pc: MonitorCog,
  "home-node": Cpu,
  camera: Camera,
  microphone: Mic,
  badge: Radio,
  robot: BrandMarkIcon,
};

export function DevicesView({ snapshot }: { snapshot: ControlCenterSnapshot }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedDevice = snapshot.devices.find((device) => device.deviceId === selectedId);

  return (
    <div className="devices-view">
      <div className="view-heading">
        <div>
          <span>DEVICES / 设备管理</span>
          <h1>协作终端</h1>
        </div>
        <div className="device-totals">
          <span><i className="tone-green" /> {snapshot.devices.filter((device) => device.connection === "online").length} 在线</span>
          <span><i className="tone-yellow" /> {snapshot.devices.filter((device) => device.connection === "degraded").length} 受限</span>
          <span><i className="tone-red" /> {snapshot.devices.filter((device) => device.connection === "offline").length} 离线</span>
        </div>
      </div>

      <div className="device-grid">
        {snapshot.devices.map((device) => {
          const Icon = deviceIcons[device.kind];
          return (
            <TechPanel
              as="article"
              className={`device-card device-card--${device.connection}`}
              data-device-id={device.deviceId}
              key={device.deviceId}
            >
              <div className="device-card__top">
                <div className="device-card__source">
                  <span className="device-card__icon"><Icon size={21} /></span>
                  <span className={`adapter-mode-tag adapter-mode-tag--${device.adapterMode}`}>
                    {device.adapterMode.toUpperCase()}
                  </span>
                </div>
                <ConnectionStateView state={device.connection} />
              </div>
              <div className="device-card__identity">
                <span>{device.kind.toUpperCase()}</span>
                <h2>{device.name}</h2>
                <code>{device.deviceId}</code>
              </div>
              <p>{device.detail}</p>
              <div className="device-card__metric">
                <span>{device.metricLabel}</span>
                <strong>{device.metricValue}</strong>
              </div>
              <div className="device-card__footer">
                <span>{device.zone} · {formatRelativeTime(device.lastSeen)}</span>
                <button
                  className="icon-button"
                  type="button"
                  title={`查看 ${device.name} 配置`}
                  aria-label={`查看 ${device.name} 配置`}
                  onClick={() => setSelectedId(device.deviceId)}
                >
                  <Settings2 size={17} />
                </button>
              </div>
            </TechPanel>
          );
        })}
        {snapshot.devices.length === 0 && (
          <div className="module-unavailable module-unavailable--wide">
            <Cpu size={28} />
            <h2>设备列表为空</h2>
            <p>后端当前没有返回设备记录。</p>
          </div>
        )}
      </div>

      {selectedDevice && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={() => setSelectedId(null)}>
          <aside className="device-drawer" aria-label={`${selectedDevice.name} 设备信息`} onMouseDown={(event) => event.stopPropagation()}>
            <div className="device-drawer__header">
              <div>
                <span>DEVICE CONFIGURATION</span>
                <h2>{selectedDevice.name}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="关闭设备信息" title="关闭" onClick={() => setSelectedId(null)}>
                <X size={19} />
              </button>
            </div>
            <ConnectionStateView state={selectedDevice.connection} />
            <dl className="detail-list">
              <div><dt>稳定设备 ID</dt><dd>{selectedDevice.deviceId}</dd></div>
              <div><dt>设备类型</dt><dd>{selectedDevice.kind}</dd></div>
              <div><dt>部署区域</dt><dd>{selectedDevice.zone}</dd></div>
              <div><dt>数据源模式</dt><dd>{selectedDevice.adapterMode.toUpperCase()}</dd></div>
              <div><dt>最近心跳</dt><dd>{formatRelativeTime(selectedDevice.lastSeen)}</dd></div>
              <div><dt>{selectedDevice.metricLabel}</dt><dd>{selectedDevice.metricValue}</dd></div>
            </dl>
            {selectedDevice.kind === "camera" && (
              <CameraPreviewPanel key={selectedDevice.deviceId} device={selectedDevice} />
            )}
            <div className="adapter-boundary-note">
              <strong>{selectedDevice.adapterMode.toUpperCase()} DEVICE SOURCE</strong>
              <p>{selectedDevice.adapterMode === "mock"
                ? "当前状态由后端 MockDeviceSource 驱动；真实设备接入时保持相同设备契约。"
                : "当前状态来自后端 Live Device Adapter。"}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

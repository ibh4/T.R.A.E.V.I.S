import { Camera, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import {
  resolveCameraPreviewConfiguration,
  type CameraPreviewIssue,
} from "../../control/camera-preview";
import type { DeviceStatus } from "../../control/types";

type PreviewState = "idle" | "loading" | "live" | "error";

const issueLabels: Record<CameraPreviewIssue, string> = {
  "not-configured": "未配置",
  "invalid-url": "地址无效",
  "unsupported-protocol": "协议不支持",
  "embedded-credentials": "凭据不允许",
  "mixed-content": "需要 HTTPS",
};

export function CameraPreviewPanel({ device }: { device: DeviceStatus }) {
  const [configuration] = useState(() =>
    resolveCameraPreviewConfiguration(
      import.meta.env.VITE_HOME_CAMERA_PREVIEW_URL,
      window.location.href,
    ),
  );
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>("idle");
  const available = device.connection !== "offline" && configuration.url !== null;

  useEffect(() => {
    if (device.connection === "offline") {
      setActive(false);
      setState("idle");
    }
  }, [device.connection]);

  const start = () => {
    if (!available) return;
    setAttempt((value) => value + 1);
    setState("loading");
    setActive(true);
  };

  const stop = () => {
    setActive(false);
    setState("idle");
  };

  const status = configuration.issue
    ? issueLabels[configuration.issue]
    : device.connection === "offline"
      ? "设备离线"
      : state === "loading"
        ? "正在连接"
        : state === "live"
          ? "实时画面"
          : state === "error"
            ? "视频流不可用"
            : "待命";

  return (
    <section className="camera-preview" aria-label={`${device.name} 实时画面`}>
      <div className="camera-preview__header">
        <div>
          <span>CAMERA STREAM</span>
          <strong>{configuration.host ?? device.deviceId}</strong>
        </div>
        <span className={`camera-preview__status camera-preview__status--${state}`}>{status}</span>
      </div>

      <div className="camera-preview__viewport">
        {active && configuration.url ? (
          <img
            key={attempt}
            src={configuration.url}
            alt={`${device.name} 实时视频`}
            onLoad={() => setState("live")}
            onError={() => {
              setActive(false);
              setState("error");
            }}
          />
        ) : (
          <div className="camera-preview__standby">
            <Camera size={32} />
            <strong>{status}</strong>
          </div>
        )}
      </div>

      <div className="camera-preview__actions">
        <span>{device.zone} / MJPEG</span>
        {active ? (
          <button className="icon-text-button" type="button" onClick={stop}>
            <Square size={15} /> 停止画面
          </button>
        ) : (
          <button className="icon-text-button" type="button" disabled={!available} onClick={start}>
            {state === "error" ? <RefreshCw size={15} /> : <Play size={15} />}
            {state === "error" ? "重新连接" : "打开画面"}
          </button>
        )}
      </div>
    </section>
  );
}

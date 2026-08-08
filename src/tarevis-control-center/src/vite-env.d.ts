/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTROL_CENTER_ADAPTER?: "live" | "mock";
  readonly VITE_CONTROL_CENTER_API_BASE?: string;
  readonly VITE_CONTROL_CENTER_DEVICE_ID?: string;
  readonly VITE_CONTROL_CENTER_AUTH_MODE?: "access" | "mock";
  readonly VITE_HOME_CAMERA_PREVIEW_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

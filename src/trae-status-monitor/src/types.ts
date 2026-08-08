/**
 * T.A.R.E.V.I.S. TRAE 状态监视器 - 类型定义
 */

import type { HomeEvent, HomeEventScenario } from './home/home-types.js';

// TRAE 工作状态枚举
export enum TraeWorkStatus {
  // 空闲状态 - 等待任务
  IDLE = 'idle_ready',
  // 思考状态 - AI 正在分析或处理
  THINKING = 'thinking_scan',
  // 工作状态 - 正在执行任务（如编译、测试）
  WORKING = 'task_charge',
  // 成功完成 - 任务成功完成
  SUCCESS = 'fix_success',
  // 错误状态 - 出现错误或失败
  ERROR = 'bug_alert',
  // 警告状态 - 有问题但未完全失败
  WARNING = 'bug_maze',
  // 睡眠状态 - 长时间无活动
  SLEEPY = 'sleepy_nudge',
  // 同步状态 - 正在同步或通信
  SYNC = 'sync_ping'
}

// 状态信息接口
export interface StatusInfo {
  status: TraeWorkStatus;
  timestamp: number;
  message?: string;
  projectName?: string;
  details?: {
    fileCount?: number;
    errorCount?: number;
    lastActivity?: string;
    cpuUsage?: number;
    memoryUsage?: number;
  };
}

// TraePal 小屏三选一动作
export interface TraePalChoice {
  id: 'a' | 'b' | 'c';
  label: string;
  intent: 'inspect' | 'continue' | 'fix' | 'pause' | 'open' | 'summarize';
  summary: string;
}

// TraePal 小屏项目卡片
export interface TraePalProjectView {
  id: string;
  name: string;
  path?: string;
  status: TraeWorkStatus;
  progress: number;
  summary: string;
  updatedAt: number;
  choices: TraePalChoice[];
  metrics: {
    fileCount: number;
    errorCount: number;
    lastActivity?: string;
  };
}

export interface TraePalChoiceSubmission {
  projectId: string;
  choiceId: TraePalChoice['id'];
  label?: string;
  timestamp?: number;
}

export interface TraePalChoiceResult extends TraePalChoiceSubmission {
  accepted: boolean;
  projectName?: string;
  nextStatus: TraeWorkStatus;
  message: string;
  timestamp: number;
}

export type TraePalScreen = 'project_list' | 'project_detail' | 'choice_result';

// 发给 ESP32 / 网页预览的小屏状态包
export interface TraePalScreenState {
  type: 'traepal_screen_state';
  screen: TraePalScreen;
  title: string;
  subtitle: string;
  selectedProjectId?: string;
  status: TraeWorkStatus;
  progress: number;
  projects: TraePalProjectView[];
  detail?: TraePalProjectView;
  lastChoice?: TraePalChoiceResult;
  timestamp: number;
}

export type HomeScreen = 'home_overview' | 'home_event_detail' | 'home_choice_result';
export type HomeChoiceIntent = 'confirm' | 'view' | 'silence';

export interface HomeChoice {
  id: 'a' | 'b' | 'c';
  label: string;
  intent: HomeChoiceIntent;
  summary: string;
}

export interface HomeChoiceSubmission {
  eventId: string;
  choiceId: HomeChoice['id'];
  label?: string;
  timestamp?: number;
}

export interface HomeChoiceResult extends HomeChoiceSubmission {
  accepted: boolean;
  eventTitle?: string;
  intent?: HomeChoiceIntent;
  message: string;
  timestamp: number;
}

export interface HomeScenarioTrigger {
  scenario: HomeEventScenario;
}

// 发给网页预览的小屏家庭状态包
export interface HomeScreenState {
  type: 'home_screen_state';
  screen: HomeScreen;
  title: string;
  subtitle: string;
  status: TraeWorkStatus;
  progress: number;
  events: HomeEvent[];
  currentEvent?: HomeEvent;
  choices: HomeChoice[];
  lastChoice?: HomeChoiceResult;
  timestamp: number;
}

// MCP 资源定义
export interface TraeStatusResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

// MCP 工具定义
export interface TraeTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// WebSocket 消息类型
export interface WSMessage {
  type:
    | 'status_update'
    | 'screen_update'
    | 'home_screen_update'
    | 'select_project'
    | 'user_choice'
    | 'user_choice_ack'
    | 'trigger_home_event'
    | 'home_choice'
    | 'home_choice_ack'
    | 'subscribe'
    | 'unsubscribe'
    | 'ping'
    | 'pong';
  payload?:
    | StatusInfo
    | TraePalScreenState
    | TraePalChoiceSubmission
    | TraePalChoiceResult
    | HomeScreenState
    | HomeChoiceSubmission
    | HomeChoiceResult
    | HomeScenarioTrigger
    | string;
  timestamp?: number;
}

// 配置选项
export interface MonitorConfig {
  // 监视的项目路径
  projectPaths: string[];
  // 空闲超时时间（毫秒）- 超过此时间无活动进入睡眠
  idleTimeout: number;
  // 思考冷却时间（毫秒）- 活动停止后多久回到空闲
  thinkingCooldown: number;
  // 成功状态持续时间（毫秒）
  successDuration: number;
  // 心跳间隔（毫秒）
  heartbeatInterval: number;
  // WebSocket 端口
  wsPort: number;
  // 是否启用详细日志
  verbose: boolean;
  // 徽章 TCP 主机
  badgeHost: string;
  // 徽章 TCP 端口
  badgePort: number;
  // 是否启用徽章 TCP 桥接
  badgeEnabled: boolean;
  // 徽章初始重连间隔（毫秒），指数退避，最大 badgeMaxReconnectMs
  badgeReconnectMs: number;
  // 徽章最大重连间隔（毫秒）
  badgeMaxReconnectMs: number;
}

// 默认配置
export const DEFAULT_CONFIG: MonitorConfig = {
  projectPaths: [],
  idleTimeout: 300000, // 5分钟
  thinkingCooldown: 30000, // 30秒
  successDuration: 10000, // 10秒
  heartbeatInterval: 30000, // 30秒
  wsPort: 8765,
  verbose: true,
  badgeHost: '192.168.4.1',
  badgePort: 3333,
  badgeEnabled: true,
  badgeReconnectMs: 3000,
  badgeMaxReconnectMs: 30000
};

// 项目状态
export interface ProjectStatus {
  id: string;
  name: string;
  path: string;
  lastBuildTime?: number;
  lastBuildSuccess?: boolean;
  lastError?: string;
  fileCount: number;
  lastModified: number;
}

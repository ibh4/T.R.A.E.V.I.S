/**
 * T.A.R.E.V.I.S. WebSocket 服务器
 * 为电子吧唧和网页提供实时状态访问
 */

import { WebSocketServer, WebSocket } from 'ws';
import { StatusDetector } from './status-detector.js';
import {
  HomeChoiceSubmission,
  HomeScenarioTrigger,
  MonitorConfig,
  StatusInfo,
  TraePalChoiceSubmission,
  TraePalScreen,
  WSMessage
} from './types.js';
import { TraePalScreenModel } from './traepal-screen-model.js';
import { HomeScreenModel } from './home/home-screen-model.js';

interface ConnectedClient {
  ws: WebSocket;
  id: string;
  subscribed: boolean;
}

export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private detector: StatusDetector;
  private screenModel: TraePalScreenModel;
  private homeScreenModel: HomeScreenModel;
  private config: MonitorConfig;
  private clients: Map<string, ConnectedClient> = new Map();
  private clientIdCounter: number = 0;

  constructor(
    detector: StatusDetector,
    config: MonitorConfig,
    screenModel: TraePalScreenModel,
    homeScreenModel: HomeScreenModel
  ) {
    this.detector = detector;
    this.config = config;
    this.screenModel = screenModel;
    this.homeScreenModel = homeScreenModel;
  }

  /**
   * 启动 WebSocket 服务器
   */
  start(): void {
    this.wss = new WebSocketServer({ port: this.config.wsPort });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client_${++this.clientIdCounter}`;
      const client: ConnectedClient = { ws, id: clientId, subscribed: true };

      this.clients.set(clientId, client);
      console.log(`[WSBridge] Client connected: ${clientId}`);

      // 发送欢迎消息
      this.sendToClient(client, {
        type: 'subscribe',
        payload: `Connected as ${clientId}`
      });

      // 发送当前状态
      this.sendStatusToClient(client, this.detector.getCurrentStatus());
      this.sendScreenToClient(client);
      this.sendHomeScreenToClient(client);

      // 处理消息
      ws.on('message', (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(client, message);
        } catch (error) {
          console.error(`[WSBridge] Invalid message from ${clientId}:`, error);
        }
      });

      // 处理断开
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WSBridge] Client disconnected: ${clientId}`);
      });

      // 处理错误
      ws.on('error', (error) => {
        console.error(`[WSBridge] Client error ${clientId}:`, error);
      });
    });

    // 监听状态更新
    this.detector.on('statusUpdate', (status: StatusInfo) => {
      this.broadcastStatus(status);
      this.broadcastScreen();
    });

    this.screenModel.on('choice', (result) => {
      this.broadcast({
        type: 'user_choice_ack',
        payload: result
      });
    });

    this.homeScreenModel.on('homeUpdate', () => {
      this.broadcastHomeScreen();
    });

    this.homeScreenModel.on('homeChoice', (result) => {
      this.broadcast({
        type: 'home_choice_ack',
        payload: result
      });
      this.broadcastHomeScreen('home_choice_result');
    });

    console.log(`[WSBridge] WebSocket server started on port ${this.config.wsPort}`);
  }

  /**
   * 停止 WebSocket 服务器
   */
  stop(): void {
    if (this.wss) {
      // 关闭所有客户端连接
      for (const [id, client] of this.clients) {
        client.ws.close();
      }
      this.clients.clear();

      this.wss.close();
      this.wss = null;
      console.log('[WSBridge] WebSocket server stopped');
    }
  }

  /**
   * 处理客户端消息
   */
  private handleMessage(client: ConnectedClient, message: WSMessage): void {
    switch (message.type) {
      case 'subscribe':
        client.subscribed = true;
        this.sendToClient(client, { type: 'subscribe', payload: 'Subscribed to status updates' });
        break;

      case 'unsubscribe':
        client.subscribed = false;
        this.sendToClient(client, { type: 'unsubscribe', payload: 'Unsubscribed from status updates' });
        break;

      case 'ping':
        this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
        break;

      case 'select_project':
        if (typeof message.payload === 'string') {
          this.screenModel.selectProject(message.payload);
          this.sendScreenToClient(client, 'project_detail');
        } else if (message.payload && typeof message.payload === 'object' && 'projectId' in message.payload) {
          this.screenModel.selectProject(String(message.payload.projectId));
          this.sendScreenToClient(client, 'project_detail');
        }
        break;

      case 'user_choice':
        if (this.isChoiceSubmission(message.payload)) {
          this.screenModel.submitChoice(message.payload);
          this.broadcastScreen('choice_result');
        } else {
          console.log(`[WSBridge] Invalid user_choice payload from ${client.id}`);
        }
        break;

      case 'trigger_home_event':
        if (this.isHomeScenarioTrigger(message.payload)) {
          this.homeScreenModel.triggerScenario(message.payload.scenario);
        } else if (typeof message.payload === 'string' && this.isHomeScenarioName(message.payload)) {
          this.homeScreenModel.triggerScenario(message.payload);
        } else {
          console.log(`[WSBridge] Invalid trigger_home_event payload from ${client.id}`);
        }
        break;

      case 'home_choice':
        if (this.isHomeChoiceSubmission(message.payload)) {
          this.homeScreenModel.submitChoice(message.payload);
        } else {
          console.log(`[WSBridge] Invalid home_choice payload from ${client.id}`);
        }
        break;

      default:
        console.log(`[WSBridge] Unknown message type: ${message.type}`);
    }
  }

  /**
   * 发送消息到指定客户端
   */
  private sendToClient(client: ConnectedClient, message: WSMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
    }
  }

  /**
   * 发送状态到指定客户端
   */
  private sendStatusToClient(client: ConnectedClient, status: StatusInfo): void {
    if (client.subscribed) {
      this.sendToClient(client, {
        type: 'status_update',
        payload: status
      });
    }
  }

  private sendScreenToClient(client: ConnectedClient, screen?: TraePalScreen): void {
    if (client.subscribed) {
      this.sendToClient(client, {
        type: 'screen_update',
        payload: this.screenModel.getScreenState(screen)
      });
    }
  }

  private sendHomeScreenToClient(client: ConnectedClient): void {
    if (client.subscribed) {
      this.sendToClient(client, {
        type: 'home_screen_update',
        payload: this.homeScreenModel.getHomeScreenState()
      });
    }
  }

  /**
   * 广播状态到所有订阅的客户端
   */
  private broadcastStatus(status: StatusInfo): void {
    this.broadcast({
      type: 'status_update',
      payload: status
    });
  }

  /**
   * 广播小屏状态到所有订阅的客户端
   */
  private broadcastScreen(screen?: TraePalScreen): void {
    this.broadcast({
      type: 'screen_update',
      payload: this.screenModel.getScreenState(screen)
    });
  }

  private broadcastHomeScreen(screen?: 'home_overview' | 'home_event_detail' | 'home_choice_result'): void {
    this.broadcast({
      type: 'home_screen_update',
      payload: this.homeScreenModel.getHomeScreenState(screen)
    });
  }

  private broadcast(message: WSMessage): void {
    for (const [, client] of this.clients) {
      if (client.subscribed) {
        this.sendToClient(client, message);
      }
    }
  }

  private isChoiceSubmission(payload: WSMessage['payload']): payload is TraePalChoiceSubmission {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'projectId' in payload &&
      'choiceId' in payload &&
      ['a', 'b', 'c'].includes(String(payload.choiceId))
    );
  }

  private isHomeChoiceSubmission(payload: WSMessage['payload']): payload is HomeChoiceSubmission {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'eventId' in payload &&
      'choiceId' in payload &&
      ['a', 'b', 'c'].includes(String(payload.choiceId))
    );
  }

  private isHomeScenarioTrigger(payload: WSMessage['payload']): payload is HomeScenarioTrigger {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'scenario' in payload &&
      this.isHomeScenarioName(String(payload.scenario))
    );
  }

  private isHomeScenarioName(value: string): value is HomeScenarioTrigger['scenario'] {
    return ['delivery', 'visitor', 'door', 'kitchen', 'fall'].includes(value);
  }

  /**
   * 获取连接数
   */
  getConnectionCount(): number {
    return this.clients.size;
  }
}

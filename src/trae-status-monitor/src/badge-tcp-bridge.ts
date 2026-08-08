import { Socket } from 'net';
import { StatusDetector } from './status-detector.js';
import { HomeScreenState, MonitorConfig, StatusInfo, TraeWorkStatus } from './types.js';
import { HomeScreenModel } from './home/home-screen-model.js';

const BADGE_COMMANDS = {
  IDLE: 'idle_ready',
  BUG_ALERT: 'bug_alert',
  FIX_SUCCESS: 'fix_success'
} as const;

type BadgeCommand = typeof BADGE_COMMANDS[keyof typeof BADGE_COMMANDS];

function mapStatusToCommand(status: TraeWorkStatus): BadgeCommand {
  switch (status) {
    case TraeWorkStatus.IDLE:
    case TraeWorkStatus.THINKING:
    case TraeWorkStatus.WORKING:
    case TraeWorkStatus.SLEEPY:
    case TraeWorkStatus.SYNC:
      return BADGE_COMMANDS.IDLE;
    case TraeWorkStatus.SUCCESS:
      return BADGE_COMMANDS.FIX_SUCCESS;
    case TraeWorkStatus.ERROR:
    case TraeWorkStatus.WARNING:
      return BADGE_COMMANDS.BUG_ALERT;
    default:
      return BADGE_COMMANDS.IDLE;
  }
}

export class BadgeTcpBridge {
  private detector: StatusDetector;
  private homeScreenModel?: HomeScreenModel;
  private config: MonitorConfig;
  private socket: Socket | null = null;
  private currentCommand: BadgeCommand | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectMs: number;
  private isStopping: boolean = false;

  constructor(detector: StatusDetector, config: MonitorConfig, homeScreenModel?: HomeScreenModel) {
    this.detector = detector;
    this.homeScreenModel = homeScreenModel;
    this.config = config;
    this.currentReconnectMs = config.badgeReconnectMs;
  }

  start(): void {
    if (!this.config.badgeEnabled) {
      this.log('Badge bridge disabled');
      return;
    }

    this.log(`Starting badge TCP bridge, connecting to ${this.config.badgeHost}:${this.config.badgePort}`);
    this.isStopping = false;
    this.connect();

    this.detector.on('statusUpdate', (status: StatusInfo) => {
      this.handleStatusUpdate(status);
    });

    if (this.homeScreenModel) {
      this.homeScreenModel.on('homeUpdate', (state: HomeScreenState) => {
        this.handleHomeScreenUpdate(state);
      });
    }
  }

  stop(): void {
    this.log('Stopping badge TCP bridge...');
    this.isStopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (e) {
        // ignore
      }
      this.socket = null;
    }

    this.log('Badge TCP bridge stopped');
  }

  private connect(): void {
    if (this.isStopping) return;

    try {
      this.socket = new Socket();

      this.socket.on('connect', () => {
        this.log(`Connected to badge at ${this.config.badgeHost}:${this.config.badgePort}`);
        this.currentReconnectMs = this.config.badgeReconnectMs;

        const currentStatus = this.detector.getCurrentStatus();
        const command = mapStatusToCommand(currentStatus.status);
        this.sendCommand(command);
      });

      this.socket.on('data', (data) => {
        this.log(`Received from badge: ${data.toString().trim()}`);
      });

      this.socket.on('close', () => {
        this.log('Connection to badge closed');
        this.socket = null;
        this.scheduleReconnect();
      });

      this.socket.on('error', (err) => {
        this.log(`Connection error: ${err.message}`);
      });

      this.socket.connect(this.config.badgePort, this.config.badgeHost);
    } catch (err) {
      this.log(`Failed to create socket: ${err}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isStopping) return;
    if (this.reconnectTimer) return;

    this.log(`Reconnecting in ${this.currentReconnectMs}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentReconnectMs = Math.min(
        this.currentReconnectMs * 2,
        this.config.badgeMaxReconnectMs
      );
      this.connect();
    }, this.currentReconnectMs);
  }

  private handleStatusUpdate(status: StatusInfo): void {
    const command = mapStatusToCommand(status.status);

    if (command !== this.currentCommand) {
      this.sendCommand(command);
    }
  }

  private handleHomeScreenUpdate(state: HomeScreenState): void {
    const command = mapStatusToCommand(state.status);

    if (command !== this.currentCommand) {
      this.sendCommand(command);
    }
  }

  private sendCommand(command: BadgeCommand): void {
    if (!this.socket || this.socket.readyState !== 'open') {
      this.log(`Cannot send "${command}" - not connected`);
      return;
    }

    try {
      this.socket.write(`${command}\n`);
      this.currentCommand = command;
      this.log(`Sent: ${command}`);
    } catch (err) {
      this.log(`Failed to send command: ${err}`);
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[BadgeBridge] ${new Date().toISOString()} - ${message}`);
    }
  }
}

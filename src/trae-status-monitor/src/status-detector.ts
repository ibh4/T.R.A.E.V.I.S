/**
 * T.A.R.E.V.I.S. 状态检测器
 * 检测 TRAE 工作状态并更新
 */

import { EventEmitter } from 'events';
import chokidar, { FSWatcher } from 'chokidar';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { TraeWorkStatus, StatusInfo, MonitorConfig, ProjectStatus } from './types.js';

export class StatusDetector extends EventEmitter {
  private config: MonitorConfig;
  private watchers: FSWatcher[] = [];
  private currentStatus: TraeWorkStatus = TraeWorkStatus.IDLE;
  private lastActivityTime: number = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;
  private cooldownTimer: NodeJS.Timeout | null = null;
  private successTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private projectStatuses: Map<string, ProjectStatus> = new Map();
  private fileChangeCount: number = 0;
  private errorCount: number = 0;
  private isBuilding: boolean = false;

  constructor(config: MonitorConfig) {
    super();
    this.config = config;
  }

  /**
   * 启动状态检测
   */
  async start(): Promise<void> {
    this.log('Starting status detector...');

    // 初始化项目状态
    for (const projectPath of this.config.projectPaths) {
      await this.initProjectStatus(projectPath);
    }

    // 启动文件监听
    this.startFileWatchers();

    // 启动心跳
    this.startHeartbeat();

    // 启动空闲检测
    this.startIdleDetection();

    this.updateStatus(TraeWorkStatus.IDLE, 'System initialized');
    this.log('Status detector started');
  }

  /**
   * 停止状态检测
   */
  async stop(): Promise<void> {
    this.log('Stopping status detector...');

    // 清理定时器
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }

    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 关闭文件监听器
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];

    this.log('Status detector stopped');
  }

  /**
   * 获取当前状态
   */
  getCurrentStatus(): StatusInfo {
    return {
      status: this.currentStatus,
      timestamp: Date.now(),
      message: this.getStatusMessage(),
      details: {
        fileCount: this.fileChangeCount,
        errorCount: this.errorCount,
        lastActivity: new Date(this.lastActivityTime).toISOString()
      }
    };
  }

  /**
   * 获取所有监视项目的快照
   */
  getProjectStatuses(): ProjectStatus[] {
    return Array.from(this.projectStatuses.values()).map((project) => ({ ...project }));
  }

  /**
   * 手动设置状态
   */
  setStatus(status: TraeWorkStatus, message?: string): void {
    this.updateStatus(status, message);
  }

  /**
   * 记录构建结果
   */
  recordBuildResult(success: boolean, errorMessage?: string): void {
    this.isBuilding = false;

    if (success) {
      this.errorCount = 0;
      this.updateStatus(TraeWorkStatus.SUCCESS, 'Build succeeded');
      // 成功状态持续一段时间后回到空闲
      this.scheduleSuccessCooldown();
    } else {
      this.errorCount++;
      this.updateStatus(TraeWorkStatus.ERROR, errorMessage || 'Build failed');
    }

    // 更新项目状态
    for (const [, project] of this.projectStatuses) {
      project.lastBuildTime = Date.now();
      project.lastBuildSuccess = success;
      if (errorMessage) {
        project.lastError = errorMessage;
      }
    }
  }

  /**
   * 记录活动
   */
  recordActivity(type: 'file_change' | 'user_action' | 'ai_request' | 'build' | 'test'): void {
    this.lastActivityTime = Date.now();
    this.fileChangeCount++;

    // 根据活动类型更新状态
    switch (type) {
      case 'ai_request':
      case 'file_change':
        if (!this.isBuilding && this.currentStatus !== TraeWorkStatus.ERROR) {
          this.updateStatus(TraeWorkStatus.THINKING, `Processing ${type}`);
          // 设置冷却计时器，活动停止后一段时间回到空闲
          this.scheduleThinkingCooldown();
        }
        break;
      case 'build':
        this.isBuilding = true;
        this.updateStatus(TraeWorkStatus.WORKING, 'Building project...');
        // 清除之前的冷却计时器
        this.clearCooldownTimers();
        break;
      case 'test':
        this.updateStatus(TraeWorkStatus.WORKING, 'Running tests...');
        this.clearCooldownTimers();
        break;
      case 'user_action':
        this.updateStatus(TraeWorkStatus.SYNC, 'User action detected');
        this.scheduleThinkingCooldown();
        break;
    }

    // 重置空闲检测
    this.resetIdleDetection();
  }

  private async initProjectStatus(projectPath: string): Promise<void> {
    if (!existsSync(projectPath)) {
      this.log(`Project path does not exist: ${projectPath}`);
      return;
    }

    const name = projectPath.split(/[\\/]/).pop() || 'unknown';
    const fileCount = this.countFiles(projectPath);

    this.projectStatuses.set(projectPath, {
      id: this.createProjectId(projectPath),
      name,
      path: projectPath,
      fileCount,
      lastModified: Date.now()
    });

    this.log(`Initialized project: ${name} (${fileCount} files)`);
  }

  private createProjectId(projectPath: string): string {
    const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
    const name = normalized.split('/').filter(Boolean).pop() || 'project';
    let hash = 0;

    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }

    const suffix = (hash >>> 0).toString(36).slice(-6);
    const safeName = name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    return `${safeName}-${suffix}`;
  }

  private countFiles(dir: string, extensions?: string[]): number {
    let count = 0;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // 跳过 node_modules, .git, dist 等目录
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build', '.next', 'target', 'bin', 'obj'].includes(entry.name)) {
            count += this.countFiles(fullPath, extensions);
          }
        } else if (entry.isFile()) {
          if (!extensions) {
            count++;
          } else {
            const ext = extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              count++;
            }
          }
        }
      }
    } catch (error) {
      this.log(`Error counting files in ${dir}: ${error}`);
    }

    return count;
  }

  private startFileWatchers(): void {
    for (const projectPath of this.config.projectPaths) {
      if (!existsSync(projectPath)) continue;

      const watcher = chokidar.watch(projectPath, {
        ignored: [
          /(^|[\/\\])\../, // 隐藏文件
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**'
        ],
        persistent: true,
        ignoreInitial: true,
        depth: 10
      });

      watcher
        .on('add', (path) => this.handleFileChange('add', path))
        .on('change', (path) => this.handleFileChange('change', path))
        .on('unlink', (path) => this.handleFileChange('unlink', path))
        .on('error', (error) => this.log(`Watcher error: ${error}`));

      this.watchers.push(watcher);
      this.log(`Started watching: ${projectPath}`);
    }
  }

  private handleFileChange(event: string, path: string): void {
    this.recordActivity('file_change');

    // 更新项目文件计数
    for (const [projectPath, project] of this.projectStatuses) {
      if (path.startsWith(projectPath)) {
        project.lastModified = Date.now();
        if (event === 'add') {
          project.fileCount++;
        } else if (event === 'unlink') {
          project.fileCount--;
        }
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const status = this.getCurrentStatus();
      this.emit('statusUpdate', status);
    }, this.config.heartbeatInterval);
  }

  private startIdleDetection(): void {
    this.checkIdle();
  }

  private resetIdleDetection(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // 如果当前是睡眠状态，恢复到空闲状态
    if (this.currentStatus === TraeWorkStatus.SLEEPY) {
      this.updateStatus(TraeWorkStatus.IDLE, 'Activity detected');
    }

    this.checkIdle();
  }

  /**
   * 设置思考状态冷却计时器
   * 活动停止后一段时间自动回到空闲状态
   */
  private scheduleThinkingCooldown(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    this.cooldownTimer = setTimeout(() => {
      if (this.currentStatus === TraeWorkStatus.THINKING ||
          this.currentStatus === TraeWorkStatus.SYNC) {
        this.updateStatus(TraeWorkStatus.IDLE, 'Activity settled - returning to idle');
        this.log('Cooling down from thinking/sync to idle');
      }
      this.cooldownTimer = null;
    }, this.config.thinkingCooldown);
  }

  /**
   * 设置成功状态冷却计时器
   * 成功状态持续一段时间后回到空闲状态
   */
  private scheduleSuccessCooldown(): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }

    this.successTimer = setTimeout(() => {
      if (this.currentStatus === TraeWorkStatus.SUCCESS) {
        this.updateStatus(TraeWorkStatus.IDLE, 'Success acknowledged - returning to idle');
        this.log('Cooling down from success to idle');
      }
      this.successTimer = null;
    }, this.config.successDuration);
  }

  /**
   * 清除所有冷却计时器
   */
  private clearCooldownTimers(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
  }

  private checkIdle(): void {
    const idleTime = Date.now() - this.lastActivityTime;

    if (idleTime >= this.config.idleTimeout) {
      if (this.currentStatus !== TraeWorkStatus.SLEEPY) {
        this.updateStatus(TraeWorkStatus.SLEEPY, 'Idle timeout - entering sleep mode');
      }
    } else {
      // 安排下一次检查
      this.idleTimer = setTimeout(() => this.checkIdle(), 60000); // 每分钟检查一次
    }
  }

  private updateStatus(status: TraeWorkStatus, message?: string): void {
    if (this.currentStatus !== status || message) {
      this.currentStatus = status;

      const statusInfo: StatusInfo = {
        status,
        timestamp: Date.now(),
        message: message || this.getStatusMessage(),
        details: {
          fileCount: this.fileChangeCount,
          errorCount: this.errorCount,
          lastActivity: new Date(this.lastActivityTime).toISOString()
        }
      };

      this.emit('statusUpdate', statusInfo);
    }
  }

  private getStatusMessage(): string {
    switch (this.currentStatus) {
      case TraeWorkStatus.IDLE:
        return 'Ready and waiting';
      case TraeWorkStatus.THINKING:
        return 'Analyzing or processing';
      case TraeWorkStatus.WORKING:
        return 'Working on task';
      case TraeWorkStatus.SUCCESS:
        return 'Task completed successfully';
      case TraeWorkStatus.ERROR:
        return 'Error occurred';
      case TraeWorkStatus.WARNING:
        return 'Warning - attention needed';
      case TraeWorkStatus.SLEEPY:
        return 'Sleeping - no activity';
      case TraeWorkStatus.SYNC:
        return 'Synchronizing';
      default:
        return 'Unknown status';
    }
  }

  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[StatusDetector] ${new Date().toISOString()} - ${message}`);
    }
  }
}

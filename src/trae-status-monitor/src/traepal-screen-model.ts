import { EventEmitter } from 'events';
import { StatusDetector } from './status-detector.js';
import {
  ProjectStatus,
  StatusInfo,
  TraePalChoice,
  TraePalChoiceResult,
  TraePalChoiceSubmission,
  TraePalProjectView,
  TraePalScreen,
  TraePalScreenState,
  TraeWorkStatus
} from './types.js';

const PROGRESS_BY_STATUS: Record<TraeWorkStatus, number> = {
  [TraeWorkStatus.IDLE]: 8,
  [TraeWorkStatus.THINKING]: 36,
  [TraeWorkStatus.WORKING]: 64,
  [TraeWorkStatus.SUCCESS]: 100,
  [TraeWorkStatus.ERROR]: 72,
  [TraeWorkStatus.WARNING]: 58,
  [TraeWorkStatus.SLEEPY]: 0,
  [TraeWorkStatus.SYNC]: 18
};

const DEFAULT_PROJECT_ID = 'trae-work-demo';

export class TraePalScreenModel extends EventEmitter {
  private detector: StatusDetector;
  private selectedProjectId?: string;
  private lastChoice?: TraePalChoiceResult;

  constructor(detector: StatusDetector) {
    super();
    this.detector = detector;
  }

  selectProject(projectId: string): TraePalScreenState {
    const projects = this.buildProjects();
    const exists = projects.some((project) => project.id === projectId);
    this.selectedProjectId = exists ? projectId : projects[0]?.id;
    return this.getScreenState('project_detail');
  }

  submitChoice(submission: TraePalChoiceSubmission): TraePalChoiceResult {
    const state = this.selectProject(submission.projectId);
    const project = state.detail || state.projects[0];
    const choice = project?.choices.find((item) => item.id === submission.choiceId);

    this.detector.recordActivity('user_action');

    this.lastChoice = {
      projectId: submission.projectId,
      choiceId: submission.choiceId,
      label: submission.label || choice?.label,
      accepted: Boolean(project && choice),
      projectName: project?.name,
      nextStatus: TraeWorkStatus.SYNC,
      message: choice
        ? `已选择: ${choice.label}`
        : `未找到选项: ${submission.choiceId}`,
      timestamp: Date.now()
    };

    this.emit('choice', this.lastChoice);
    return this.lastChoice;
  }

  getScreenState(screen?: TraePalScreen): TraePalScreenState {
    const status = this.detector.getCurrentStatus();
    const projects = this.buildProjects(status);
    const selectedProjectId = this.resolveSelectedProjectId(projects);
    const detail = projects.find((project) => project.id === selectedProjectId);
    const nextScreen = screen || (selectedProjectId ? 'project_detail' : 'project_list');

    return {
      type: 'traepal_screen_state',
      screen: nextScreen,
      title: nextScreen === 'project_list' ? 'Trae Work 项目' : detail?.name || '项目详情',
      subtitle: this.buildSubtitle(status, detail),
      selectedProjectId,
      status: detail?.status || status.status,
      progress: detail?.progress || PROGRESS_BY_STATUS[status.status],
      projects,
      detail: nextScreen === 'project_list' ? undefined : detail,
      lastChoice: nextScreen === 'choice_result' ? this.lastChoice : undefined,
      timestamp: Date.now()
    };
  }

  private resolveSelectedProjectId(projects: TraePalProjectView[]): string | undefined {
    if (this.selectedProjectId && projects.some((project) => project.id === this.selectedProjectId)) {
      return this.selectedProjectId;
    }
    this.selectedProjectId = projects[0]?.id;
    return this.selectedProjectId;
  }

  private buildProjects(status = this.detector.getCurrentStatus()): TraePalProjectView[] {
    const projectStatuses = this.detector.getProjectStatuses();

    if (projectStatuses.length === 0) {
      return [
        this.buildProjectView(
          {
            id: DEFAULT_PROJECT_ID,
            name: 'Trae Work Demo',
            path: '',
            fileCount: status.details?.fileCount || 0,
            lastModified: status.timestamp
          },
          status
        )
      ];
    }

    return projectStatuses.map((project) => this.buildProjectView(project, status));
  }

  private buildProjectView(project: ProjectStatus, status: StatusInfo): TraePalProjectView {
    const projectStatus = this.deriveProjectStatus(project, status.status);

    return {
      id: project.id,
      name: project.name,
      path: project.path,
      status: projectStatus,
      progress: this.deriveProgress(projectStatus, project),
      summary: this.buildSummary(project, status, projectStatus),
      updatedAt: project.lastModified || status.timestamp,
      choices: this.buildChoices(projectStatus),
      metrics: {
        fileCount: project.fileCount,
        errorCount: status.details?.errorCount || 0,
        lastActivity: status.details?.lastActivity
      }
    };
  }

  private deriveProjectStatus(project: ProjectStatus, fallback: TraeWorkStatus): TraeWorkStatus {
    if (project.lastBuildSuccess === true) return TraeWorkStatus.SUCCESS;
    if (project.lastBuildSuccess === false || project.lastError) return TraeWorkStatus.ERROR;
    return fallback;
  }

  private deriveProgress(status: TraeWorkStatus, project: ProjectStatus): number {
    if (project.lastBuildSuccess === true) return 100;
    return PROGRESS_BY_STATUS[status];
  }

  private buildSummary(project: ProjectStatus, status: StatusInfo, projectStatus: TraeWorkStatus): string {
    if (project.lastError) {
      return this.compactText(project.lastError, 42);
    }
    if (status.message) {
      return this.compactText(status.message, 42);
    }

    switch (projectStatus) {
      case TraeWorkStatus.THINKING:
        return '正在分析项目上下文';
      case TraeWorkStatus.WORKING:
        return '正在执行任务';
      case TraeWorkStatus.SUCCESS:
        return '任务已完成';
      case TraeWorkStatus.ERROR:
        return '发现错误，等待处理';
      case TraeWorkStatus.SYNC:
        return '正在同步用户选择';
      default:
        return `${project.fileCount} 个文件，等待下一步`;
    }
  }

  private buildSubtitle(status: StatusInfo, detail?: TraePalProjectView): string {
    if (detail) {
      return `${detail.progress}% · ${detail.summary}`;
    }
    return status.message || '同步 Trae Work 项目状态';
  }

  private buildChoices(status: TraeWorkStatus): TraePalChoice[] {
    switch (status) {
      case TraeWorkStatus.ERROR:
      case TraeWorkStatus.WARNING:
        return [
          { id: 'a', label: '看错误', intent: 'inspect', summary: '打开错误摘要' },
          { id: 'b', label: '生成修复', intent: 'fix', summary: '请求下一步修复方案' },
          { id: 'c', label: '稍后处理', intent: 'pause', summary: '暂缓当前异常' }
        ];
      case TraeWorkStatus.SUCCESS:
        return [
          { id: 'a', label: '看结果', intent: 'open', summary: '查看生成或测试结果' },
          { id: 'b', label: '继续下一步', intent: 'continue', summary: '进入后续任务' },
          { id: 'c', label: '回列表', intent: 'inspect', summary: '返回项目列表' }
        ];
      case TraeWorkStatus.WORKING:
      case TraeWorkStatus.THINKING:
        return [
          { id: 'a', label: '看进度', intent: 'inspect', summary: '显示当前阶段' },
          { id: 'b', label: '压缩摘要', intent: 'summarize', summary: '生成小屏摘要' },
          { id: 'c', label: '暂停', intent: 'pause', summary: '等待人工确认' }
        ];
      default:
        return [
          { id: 'a', label: '开始同步', intent: 'continue', summary: '刷新项目状态' },
          { id: 'b', label: '看项目', intent: 'inspect', summary: '进入项目详情' },
          { id: 'c', label: '待机', intent: 'pause', summary: '保持轻提醒' }
        ];
    }
  }

  private compactText(text: string, maxLength: number): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1)}…`;
  }
}

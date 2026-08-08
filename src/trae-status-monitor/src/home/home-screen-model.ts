import { EventEmitter } from 'events';
import {
  HomeChoice,
  HomeChoiceResult,
  HomeChoiceSubmission,
  HomeScreen,
  HomeScreenState,
  TraeWorkStatus
} from '../types.js';
import { MockHomeEventSource } from './mock-home-source.js';
import { HomeEvent, HomeEventScenario, HomeEventState } from './home-types.js';

const DEFAULT_CHOICES: HomeChoice[] = [
  { id: 'a', label: '确认', intent: 'confirm', summary: '标记家庭事件已处理' },
  { id: 'b', label: '查看', intent: 'view', summary: '查看事件详情' },
  { id: 'c', label: '静音', intent: 'silence', summary: '暂时压低当前提醒' }
];

export class HomeScreenModel extends EventEmitter {
  private source: MockHomeEventSource;
  private lastChoice?: HomeChoiceResult;

  constructor(source: MockHomeEventSource) {
    super();
    this.source = source;

    this.source.on('homeEvent', () => {
      this.emit('homeUpdate', this.getHomeScreenState());
    });

    this.source.on('homeEventClear', () => {
      this.emit('homeUpdate', this.getHomeScreenState());
    });
  }

  triggerScenario(scenario: HomeEventScenario): HomeEvent {
    return this.source.triggerScenario(scenario);
  }

  listScenarios(): ReturnType<MockHomeEventSource['listScenarios']> {
    return this.source.listScenarios();
  }

  submitChoice(submission: HomeChoiceSubmission): HomeChoiceResult {
    const event = this.source.getEvents().find((item) => item.id === submission.eventId);
    const choice = DEFAULT_CHOICES.find((item) => item.id === submission.choiceId);

    if (!event || !choice) {
      this.lastChoice = {
        ...submission,
        accepted: false,
        message: !event ? `未找到家庭事件: ${submission.eventId}` : `未找到选项: ${submission.choiceId}`,
        timestamp: Date.now()
      };
      this.emit('homeChoice', this.lastChoice);
      return this.lastChoice;
    }

    const nextState = this.deriveNextState(choice.intent);
    this.lastChoice = {
      ...submission,
      label: submission.label || choice.label,
      accepted: true,
      eventTitle: event.title,
      intent: choice.intent,
      message: this.buildChoiceMessage(choice, event),
      timestamp: Date.now()
    };

    this.source.updateEventState(event.id, nextState);
    this.emit('homeChoice', this.lastChoice);
    return this.lastChoice;
  }

  getHomeScreenState(screen?: HomeScreen): HomeScreenState {
    const events = this.source.getEvents();
    const currentEvent = this.source.getHighestPriorityEvent();
    const nextScreen = screen || (currentEvent ? 'home_event_detail' : 'home_overview');
    const status = this.mapHomeEventToStatus(currentEvent);

    return {
      type: 'home_screen_state',
      screen: nextScreen,
      title: currentEvent?.title || '家庭状态',
      subtitle: currentEvent?.summary || '家里暂无需要处理的提醒',
      status,
      progress: this.progressForStatus(status),
      events,
      currentEvent,
      choices: currentEvent ? DEFAULT_CHOICES : [],
      lastChoice: nextScreen === 'home_choice_result' ? this.lastChoice : undefined,
      timestamp: Date.now()
    };
  }

  private deriveNextState(intent: HomeChoice['intent']): HomeEventState {
    switch (intent) {
      case 'confirm':
        return 'resolved';
      case 'view':
        return 'waiting_ack';
      case 'silence':
        return 'local_alert_sent';
    }
  }

  private buildChoiceMessage(choice: HomeChoice, event: HomeEvent): string {
    switch (choice.intent) {
      case 'confirm':
        return `已确认: ${event.title}`;
      case 'view':
        return `已打开详情: ${event.title}`;
      case 'silence':
        return `已静音: ${event.title}`;
    }
  }

  private mapHomeEventToStatus(event?: HomeEvent): TraeWorkStatus {
    if (!event) return TraeWorkStatus.IDLE;
    if (event.state === 'resolved') return TraeWorkStatus.SUCCESS;
    if (event.level === 'high') return TraeWorkStatus.ERROR;
    if (event.level === 'medium') return TraeWorkStatus.WARNING;
    return TraeWorkStatus.SYNC;
  }

  private progressForStatus(status: TraeWorkStatus): number {
    switch (status) {
      case TraeWorkStatus.SUCCESS:
        return 100;
      case TraeWorkStatus.ERROR:
        return 86;
      case TraeWorkStatus.WARNING:
        return 64;
      case TraeWorkStatus.SYNC:
        return 32;
      default:
        return 8;
    }
  }
}

import { EventEmitter } from 'events';
import { selectHighestPriorityHomeEvent, transitionHomeEvent } from './home-event-adapter.js';
import {
  HOME_EVENT_SCENARIOS,
  HomeEvent,
  HomeEventScenario,
  HomeEventState,
  HomeScenarioDefinition
} from './home-types.js';

const SCENARIO_DEFINITIONS: Record<HomeEventScenario, HomeScenarioDefinition> = {
  delivery: {
    scenario: 'delivery',
    type: 'delivery_detected',
    level: 'low',
    zone: 'door',
    title: '快递到达',
    summary: '门口检测到包裹，已做轻提醒',
    ackRequired: false,
    payload: {
      cameraId: 'cam_door',
      confidence: 0.95
    }
  },
  visitor: {
    scenario: 'visitor',
    type: 'visitor_detected',
    level: 'medium',
    zone: 'door',
    title: '访客停留',
    summary: '门口检测到访客停留，请留意',
    ackRequired: false,
    payload: {
      cameraId: 'cam_door',
      confidence: 0.88
    }
  },
  door: {
    scenario: 'door',
    type: 'door_event_detected',
    level: 'high',
    zone: 'door',
    title: '门口异常',
    summary: '门口出现异常停留或包裹状态变化',
    ackRequired: true,
    payload: {
      cameraId: 'cam_door',
      confidence: 0.89
    }
  },
  kitchen: {
    scenario: 'kitchen',
    type: 'kitchen_risk_detected',
    level: 'high',
    zone: 'kitchen',
    title: '厨房风险',
    summary: '检测到厨房可能存在持续风险',
    ackRequired: true,
    payload: {
      cameraId: 'cam_kitchen',
      confidence: 0.84
    }
  },
  fall: {
    scenario: 'fall',
    type: 'fall_detected',
    level: 'high',
    zone: 'living_room',
    title: '疑似跌倒',
    summary: '检测到家人可能跌倒，需要确认',
    ackRequired: true,
    payload: {
      cameraId: 'cam_living_room',
      confidence: 0.91
    }
  }
};

export class MockHomeEventSource extends EventEmitter {
  private events: HomeEvent[] = [];
  private nextId = 1;

  listScenarios(): HomeScenarioDefinition[] {
    return HOME_EVENT_SCENARIOS.map((scenario) => SCENARIO_DEFINITIONS[scenario]);
  }

  triggerScenario(
    scenario: HomeEventScenario,
    overrides: Partial<Omit<HomeEvent, 'id' | 'type'>> = {}
  ): HomeEvent {
    const definition = SCENARIO_DEFINITIONS[scenario];
    const event: HomeEvent = {
      id: `home_evt_${String(this.nextId++).padStart(4, '0')}`,
      source: 'mock_home',
      type: definition.type,
      level: definition.level,
      zone: definition.zone,
      title: definition.title,
      summary: definition.summary,
      state: 'detected',
      ackRequired: definition.ackRequired,
      timestamp: Date.now(),
      payload: definition.payload,
      ...overrides
    };

    this.events = [event, ...this.events];
    this.emit('homeEvent', event);
    return event;
  }

  updateEventState(eventId: string, state: HomeEventState): HomeEvent | undefined {
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index < 0) return undefined;

    const nextEvent = transitionHomeEvent(this.events[index], state);
    this.events[index] = nextEvent;
    this.emit('homeEvent', nextEvent);
    return nextEvent;
  }

  getEvents(): HomeEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  getHighestPriorityEvent(): HomeEvent | undefined {
    const event = selectHighestPriorityHomeEvent(this.events);
    return event ? { ...event } : undefined;
  }

  clear(): void {
    this.events = [];
    this.emit('homeEventClear');
  }
}

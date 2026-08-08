import { HomeEvent, HomeEventLevel, HomeEventState } from './home-types.js';

const LEVEL_PRIORITY: Record<HomeEventLevel, number> = {
  high: 3,
  medium: 2,
  low: 1
};

const STATE_PRIORITY: Record<HomeEventState, number> = {
  escalated: 5,
  waiting_ack: 4,
  detected: 3,
  local_alert_sent: 2,
  resolved: 1
};

export function selectHighestPriorityHomeEvent(events: HomeEvent[]): HomeEvent | undefined {
  return [...events].sort(compareHomeEvents)[0];
}

export function compareHomeEvents(a: HomeEvent, b: HomeEvent): number {
  const activeDelta = Number(isHomeEventActive(b)) - Number(isHomeEventActive(a));
  if (activeDelta !== 0) return activeDelta;

  const levelDelta = LEVEL_PRIORITY[b.level] - LEVEL_PRIORITY[a.level];
  if (levelDelta !== 0) return levelDelta;

  const stateDelta = STATE_PRIORITY[b.state] - STATE_PRIORITY[a.state];
  if (stateDelta !== 0) return stateDelta;

  return b.timestamp - a.timestamp;
}

export function transitionHomeEvent(
  event: HomeEvent,
  state: HomeEventState,
  timestamp = Date.now()
): HomeEvent {
  return {
    ...event,
    state,
    timestamp
  };
}

export function isHomeEventActive(event: HomeEvent): boolean {
  return event.state !== 'resolved';
}

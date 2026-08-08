export const HOME_EVENT_TYPES = [
  'delivery_detected',
  'visitor_detected',
  'door_event_detected',
  'kitchen_risk_detected',
  'fall_detected'
] as const;

export const HOME_EVENT_SCENARIOS = [
  'delivery',
  'visitor',
  'door',
  'kitchen',
  'fall'
] as const;

export type HomeEventType = typeof HOME_EVENT_TYPES[number];
export type HomeEventScenario = typeof HOME_EVENT_SCENARIOS[number];
export type HomeEventLevel = 'low' | 'medium' | 'high';
export type HomeEventZone = 'door' | 'kitchen' | 'living_room';
export type HomeEventState =
  | 'detected'
  | 'local_alert_sent'
  | 'waiting_ack'
  | 'resolved'
  | 'escalated';

export interface HomeEvent {
  id: string;
  source: 'mock_home' | 'home_adapter' | 'raspberrypi_lobster_ai_butler';
  type: HomeEventType;
  level: HomeEventLevel;
  zone: HomeEventZone;
  title: string;
  summary: string;
  state: HomeEventState;
  ackRequired: boolean;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface HomeScenarioDefinition {
  scenario: HomeEventScenario;
  type: HomeEventType;
  level: HomeEventLevel;
  zone: HomeEventZone;
  title: string;
  summary: string;
  ackRequired: boolean;
  payload: Record<string, unknown>;
}

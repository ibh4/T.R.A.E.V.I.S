import { HomeScreenModel } from './home-screen-model.js';
import { MockHomeEventSource } from './mock-home-source.js';
import { TraeWorkStatus } from '../types.js';

function main(): void {
  const source = new MockHomeEventSource();
  const model = new HomeScreenModel(source);

  const initial = model.getHomeScreenState();
  assert(initial.type === 'home_screen_state', 'home screen state type mismatch');
  assert(initial.screen === 'home_overview', 'empty model should start at overview');
  assert(initial.status === TraeWorkStatus.IDLE, 'empty model should be idle');
  assert(initial.choices.length === 0, 'empty model should not expose choices');

  const event = model.triggerScenario('kitchen');
  const alertState = model.getHomeScreenState();
  assert(alertState.currentEvent?.id === event.id, 'triggered event should become current event');
  assert(alertState.status === TraeWorkStatus.ERROR, 'high priority home event should map to alert status');
  assert(alertState.choices.length === 3, 'home event should expose three choices');

  const result = model.submitChoice({
    eventId: event.id,
    choiceId: 'a'
  });
  assert(result.accepted, 'known home choice should be accepted');
  assert(result.intent === 'confirm', 'choice a should confirm the event');

  const resolvedState = model.getHomeScreenState('home_choice_result');
  assert(resolvedState.lastChoice?.choiceId === 'a', 'resolved screen should include last choice');
  assert(resolvedState.currentEvent?.state === 'resolved', 'confirmed event should be resolved');
  assert(resolvedState.status === TraeWorkStatus.SUCCESS, 'resolved event should map to success status');

  console.log('Home screen model test passed');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();

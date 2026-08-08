import { selectHighestPriorityHomeEvent } from './home-event-adapter.js';
import { MockHomeEventSource } from './mock-home-source.js';

function main(): void {
  const source = new MockHomeEventSource();
  const scenarios = source.listScenarios();

  assert(scenarios.length === 5, 'mock source should expose five home scenarios');
  assert(
    scenarios.map((item) => item.scenario).join(',') === 'delivery,visitor,door,kitchen,fall',
    'scenario order should match the demo flow'
  );

  const delivery = source.triggerScenario('delivery', { timestamp: 1000 });
  const fall = source.triggerScenario('fall', { timestamp: 900 });

  assert(delivery.type === 'delivery_detected', 'delivery scenario should produce delivery event');
  assert(delivery.level === 'low', 'delivery should be low priority');
  assert(delivery.ackRequired === false, 'delivery should not require acknowledgement');
  assert(fall.type === 'fall_detected', 'fall scenario should produce fall event');
  assert(fall.level === 'high', 'fall should be high priority');
  assert(fall.ackRequired, 'fall should require acknowledgement');

  const highest = source.getHighestPriorityEvent();
  assert(highest?.id === fall.id, 'high priority fall should outrank delivery');

  const resolved = source.updateEventState(fall.id, 'resolved');
  assert(resolved?.state === 'resolved', 'state transition should update the event');

  const explicitHighest = selectHighestPriorityHomeEvent(source.getEvents());
  assert(explicitHighest?.id === delivery.id, 'after resolving fall, delivery should be the top visible event');

  console.log('Home event mock source test passed');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();

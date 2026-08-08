import { StatusDetector } from './status-detector.js';
import { TraePalScreenModel } from './traepal-screen-model.js';
import { DEFAULT_CONFIG, MonitorConfig, TraeWorkStatus } from './types.js';

const config: MonitorConfig = {
  ...DEFAULT_CONFIG,
  projectPaths: ['.'],
  idleTimeout: 300000,
  thinkingCooldown: 30000,
  successDuration: 10000,
  heartbeatInterval: 30000,
  wsPort: 8767,
  verbose: false
};

async function main(): Promise<void> {
  const detector = new StatusDetector(config);
  await detector.start();

  const screenModel = new TraePalScreenModel(detector);
  const list = screenModel.getScreenState('project_list');

  assert(list.type === 'traepal_screen_state', 'screen state type mismatch');
  assert(list.projects.length >= 1, 'screen state should include at least one project');
  assert(list.projects[0].choices.length === 3, 'each project should expose three choices');

  const selected = screenModel.selectProject(list.projects[0].id);
  assert(selected.screen === 'project_detail', 'selectProject should switch to project detail');
  assert(selected.detail?.id === list.projects[0].id, 'selected detail should match project id');

  detector.setStatus(TraeWorkStatus.ERROR, 'Build failed at src/main.ts:42');
  const errorState = screenModel.getScreenState('project_detail');
  assert(errorState.detail?.choices[1].intent === 'fix', 'error state should offer a fix choice');

  const result = screenModel.submitChoice({
    projectId: list.projects[0].id,
    choiceId: 'b'
  });
  assert(result.accepted, 'known choice should be accepted');
  assert(result.choiceId === 'b', 'choice result should echo choice id');

  await detector.stop();
  console.log('TraePal protocol model test passed');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

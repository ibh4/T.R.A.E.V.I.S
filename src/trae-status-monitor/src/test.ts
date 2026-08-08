/**
 * T.A.R.E.V.I.S. 测试脚本
 * 测试状态检测器功能
 */

import { StatusDetector } from './status-detector.js';
import { MonitorConfig, TraeWorkStatus, DEFAULT_CONFIG } from './types.js';

// 测试配置
const testConfig: MonitorConfig = {
  ...DEFAULT_CONFIG,
  projectPaths: ['.'],
  idleTimeout: 10000,
  thinkingCooldown: 3000,
  successDuration: 2000,
  heartbeatInterval: 3000,
  wsPort: 8766,
  verbose: true,
  badgeEnabled: false
};

async function runTest(): Promise<void> {
  console.log('===========================================');
  console.log('  T.A.R.E.V.I.S. Status Detector Test');
  console.log('===========================================');
  console.log('');

  const detector = new StatusDetector(testConfig);

  // 监听状态更新
  detector.on('statusUpdate', (status) => {
    console.log(`[STATUS UPDATE] ${status.status} - ${status.message}`);
  });

  // 启动
  await detector.start();
  console.log('Detector started');
  console.log('');

  // 模拟活动
  console.log('Simulating activities...');

  // 1. 文件变更
  await simulateDelay(1000);
  detector.recordActivity('file_change');
  console.log('Recorded file change');

  // 2. AI 请求
  await simulateDelay(1000);
  detector.recordActivity('ai_request');
  console.log('Recorded AI request');

  // 3. 构建
  await simulateDelay(1000);
  detector.recordActivity('build');
  console.log('Recorded build start');

  // 4. 构建结果
  await simulateDelay(2000);
  detector.recordBuildResult(true);
  console.log('Recorded build success');

  // 5. 测试
  await simulateDelay(1000);
  detector.recordActivity('test');
  console.log('Recorded test start');

  await simulateDelay(2000);
  detector.recordBuildResult(false, 'Test failed: assertion error');
  console.log('Recorded test failure');

  // 打印当前状态
  console.log('');
  console.log('Current status:');
  console.log(JSON.stringify(detector.getCurrentStatus(), null, 2));

  // 等待一段时间观察状态变化
  console.log('');
  console.log('Waiting for idle timeout (10 seconds)...');
  await simulateDelay(12000);

  // 最后的空闲状态
  console.log('');
  console.log('Final status:');
  console.log(JSON.stringify(detector.getCurrentStatus(), null, 2));

  // 停止
  await detector.stop();
  console.log('');
  console.log('Test completed');
}

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runTest().catch((error) => {
  console.error('Test error:', error);
  process.exit(1);
});

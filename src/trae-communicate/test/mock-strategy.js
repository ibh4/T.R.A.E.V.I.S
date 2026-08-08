export function createMockStrategy(options = {}) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let closed = false;

  const strategy = {
    name: options.name ?? 'mock',
    calls,
    get active() {
      return active;
    },
    get maxActive() {
      return maxActive;
    },
    async checkReady() {
      return options.ready === false
        ? {
          ready: false,
          checks: { strategyLoaded: true, mockReady: false },
          reason: options.readyReason ?? 'Mock strategy is unavailable.'
        }
        : { ready: true, checks: { strategyLoaded: true, mockReady: true } };
    },
    async sendPrompt(text) {
      if (closed) throw new Error('Mock strategy is closed.');
      calls.push(text);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (options.onSend) return await options.onSend(text, strategy);
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        return {
          success: true,
          sent: true,
          message: 'mock prompt sent',
          response: { status: 'skipped', reason: 'Mock response reading skipped.' }
        };
      } finally {
        active -= 1;
      }
    },
    async close() {
      closed = true;
      await options.onClose?.();
    }
  };

  return strategy;
}

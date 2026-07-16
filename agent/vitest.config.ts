import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests hit the live KeeperHub MCP + Sepolia and need a real
    // KH_API_KEY; give them room to poll to a terminal execution state.
    testTimeout: 120_000,
  },
});

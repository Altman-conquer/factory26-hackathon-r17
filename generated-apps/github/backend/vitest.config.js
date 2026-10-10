const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    hookTimeout: 60000,
    testTimeout: 30000,
    include: ['tests/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['test-e2e/**/*'],
  },
});

// Framework/tool-generated: React/npm
// AI-USAGE SUMMARY
// Tools: ChatGPT
// Used for: configuring vitest component testing and coverage reporting
// Overall AI contribution: 35%

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test:{
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    }
  }

})

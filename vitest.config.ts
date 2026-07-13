import { defineConfig } from 'vitest/config'

// Standalone config so unit tests run in plain Node without loading the
// Cloudflare Vite plugin (which expects the full Worker build environment).
export default defineConfig({
	test: {
		environment: 'node',
		include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
	},
})

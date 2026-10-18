import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { cloudflare } from "@cloudflare/vite-plugin"

// One id for the SPA and the Worker, which this single build produces together.
// CI deploys from a commit, so its SHA names the build; a local build gets a
// timestamp so each one still differs. See shared/build.ts.
const BUILD_ID = process.env.GITHUB_SHA ?? `local-${Date.now()}`

// https://vite.dev/config/
export default defineConfig({
	define: {
		__BUILD_ID__: JSON.stringify(BUILD_ID),
	},
	plugins: [
		vue(),
		// vueDevTools(),
		cloudflare()
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		},
	},
})

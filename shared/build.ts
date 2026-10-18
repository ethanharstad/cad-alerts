// Replaced at build time by Vite's `define` (see vite.config.ts). Vitest does
// not load that config, so outside a real build the identifier is simply absent.
declare const __BUILD_ID__: string | undefined

/**
 * Identifies the build this code came from. The SPA and the Worker are built
 * together by one `vite build`, so they always carry the same id: the Worker
 * reports its id to clients (the `X-Build-Id` response header), and a dashboard
 * that sees one different from its own knows a newer deploy is live and reloads
 * onto it (src/update/reload.ts).
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

/** Response header the Worker stamps its {@link BUILD_ID} on. */
export const BUILD_ID_HEADER = 'X-Build-Id'

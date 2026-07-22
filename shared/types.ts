/**
 * Shared API contract types used by both the Worker (server) and the SPA
 * (src). These are plain interfaces with no runtime dependencies so they can
 * be imported from the browser bundle via `import type` without pulling in
 * Drizzle or any server code.
 *
 * The server's Drizzle row types are checked against these at compile time in
 * `server/schema.ts`, so a schema change that drifts from this contract fails
 * type-checking.
 */

export interface Organization {
	org_id: string
	org_key: string
	access_key: string
	name: string
	/** Default city used later for address disambiguation / mapping. */
	default_city: string | null
	/** Default state used later for address disambiguation / mapping. */
	default_state: string | null
	/**
	 * The organization's token-based text-to-speech template (see
	 * `shared/ttsTemplate.ts`). Null means fall back to the default template.
	 */
	tts_template: string | null
}

/**
 * The organization shape safe to return to clients. Omits `access_key`, which
 * is a shared secret used only for authentication and must never be sent back
 * in an API response. The settings fields are included so the SPA can display
 * and edit them.
 */
export type PublicOrganization = Omit<Organization, 'access_key'>

/**
 * The editable organization-level settings, as sent to the settings write
 * endpoint. Each field is nullable; a null clears the stored value (the app
 * then falls back to its default).
 */
export interface OrgSettings {
	default_city: string | null
	default_state: string | null
	tts_template: string | null
}

export interface Alert {
	alert_id: string
	organization: string
	body: string
	audio_url: string
	timestamp: number
	source: string
	nature: string
	address: string
	city: string
	latitude: number | null
	longitude: number | null
}

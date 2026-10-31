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
	/**
	 * How recent a call must be, in minutes, for a dashboard to read it out loud.
	 * Past it the call is no longer actionable and announcing it would talk over
	 * whatever is happening now. Null means fall back to the default window.
	 */
	actionable_window_minutes: number | null
	/**
	 * Id of the built-in tone played before an alert outside quiet hours (see
	 * `shared/alertTones.ts`). Null means no tone.
	 */
	alert_tone: string | null
	/** Id of the tone played during quiet hours. Null means no tone. */
	quiet_alert_tone: string | null
	/**
	 * Start of quiet hours, in minutes after the dashboard's local midnight.
	 * Set together with `quiet_hours_end`; both null means no quiet hours. A
	 * window whose end is before its start wraps past midnight.
	 */
	quiet_hours_start: number | null
	/** End of quiet hours (exclusive), in minutes after local midnight. */
	quiet_hours_end: number | null
	/**
	 * Who may send this organization pre-alerts: newline-separated exact
	 * addresses and/or `@domain` entries (see `shared/senders.ts`). Null allows
	 * every sender.
	 */
	allowed_senders: string | null
	/**
	 * Admin-only soft cap on alerts (new or revised) per rolling hour. Going over
	 * is reported but the alert is still delivered. Null means no cap. Set by
	 * hand in the database; never sent to or accepted from clients.
	 */
	alert_cap_hourly: number | null
	/** Admin-only soft cap per rolling 30 days; see `alert_cap_hourly`. */
	alert_cap_monthly: number | null
}

/** Organization fields only an administrator may see or change (via SQL). */
export type AdminOnlyOrgField = 'alert_cap_hourly' | 'alert_cap_monthly'

/**
 * The organization shape safe to return to clients. Omits `access_key`, which
 * is a shared secret used only for authentication and must never be sent back
 * in an API response, and the admin-only usage caps. The settings fields are included so the SPA can display
 * and edit them.
 */
export type PublicOrganization = Omit<Organization, 'access_key' | AdminOnlyOrgField>

/**
 * The editable organization-level settings, as sent to the settings write
 * endpoint. Each field is nullable; a null clears the stored value (the app
 * then falls back to its default).
 */
export interface OrgSettings {
	default_city: string | null
	default_state: string | null
	tts_template: string | null
	actionable_window_minutes: number | null
	alert_tone: string | null
	quiet_alert_tone: string | null
	quiet_hours_start: number | null
	quiet_hours_end: number | null
	allowed_senders: string | null
}

export interface Alert {
	alert_id: string
	organization: string
	body: string
	audio_url: string
	/** When the incident happened; orders the recent list. */
	timestamp: number
	/**
	 * When the row last changed — equal to `timestamp` on insert, bumped when a
	 * follow-up email revises the incident. The live stream cursors on this.
	 */
	updated_at: number
	source: string
	nature: string
	address: string
	city: string
	latitude: number | null
	longitude: number | null
}

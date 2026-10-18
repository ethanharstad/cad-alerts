/**
 * Optional per-browser audio output selection.
 *
 * By default every clip plays on the system's default output. A dashboard can
 * instead pin alerts to one device (say, the bay PA) so they keep going there
 * when a headset or monitor takes over the system default, and so other audio on
 * the machine is left alone. Device ids are scoped to this site and browser
 * profile, so the choice is stored per browser, never on the organization.
 *
 * The id `''` always means "system default", and every failure falls back to
 * it — a missing or unusable device must never stop an alert from sounding.
 */

export interface OutputDevice {
	deviceId: string
	label: string
}

/** Whether this browser can route an audio element to a chosen device. */
export function supportsOutputSelection(): boolean {
	return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

/**
 * The selectable outputs this page may use. Browsers withhold device ids until
 * the page has been granted media access (see {@link requestOutputAccess}), so
 * before that this is usually empty. The `default` and `communications` entries
 * are aliases for whatever the system currently points at, so they are dropped:
 * "System default" is already the `''` choice.
 */
export async function listOutputDevices(): Promise<OutputDevice[]> {
	if (!navigator.mediaDevices?.enumerateDevices) return []
	const devices = await navigator.mediaDevices.enumerateDevices()
	return devices
		.filter(
			(d) =>
				d.kind === 'audiooutput' &&
				d.deviceId !== '' &&
				d.deviceId !== 'default' &&
				d.deviceId !== 'communications',
		)
		.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))
}

/**
 * Ask for the media permission browsers require before they reveal output
 * devices. Chromium and Firefox tie it to the microphone: the stream is stopped
 * straight away and nothing is recorded. Must be called from a user gesture.
 */
export async function requestOutputAccess(): Promise<void> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	for (const track of stream.getTracks()) track.stop()
}

/**
 * Find the saved device among those connected now, returning its current id:
 * `''` for the system default, `null` when the device is known to be gone, and
 * `undefined` when the browser does not let us tell (no permission yet, or no
 * support), so callers only warn about a device they know is missing.
 *
 * Browsers re-issue device ids when site data is cleared (and some headless
 * builds do on every load), so a saved id that no longer matches falls back to
 * the one device carrying the saved label; the caller should store the new id.
 */
export async function resolveOutputDevice(
	deviceId: string,
	label: string,
): Promise<string | null | undefined> {
	if (!deviceId) return ''
	if (!supportsOutputSelection()) return undefined
	let devices: OutputDevice[]
	try {
		devices = await listOutputDevices()
	} catch {
		return undefined
	}
	if (devices.length === 0) return undefined
	if (devices.some((d) => d.deviceId === deviceId)) return deviceId
	const sameLabel = label ? devices.filter((d) => d.label === label) : []
	return sameLabel.length === 1 ? sameLabel[0]!.deviceId : null
}

/**
 * Route one media element to `deviceId`, resolving `true` when it will play
 * there (or `deviceId` is the default) and `false` when it fell back to the
 * system default because the device is missing or the browser refused.
 */
export async function applyOutputDevice(
	el: Partial<Pick<HTMLMediaElement, 'setSinkId' | 'sinkId'>>,
	deviceId: string,
): Promise<boolean> {
	if (typeof el.setSinkId !== 'function') return !deviceId
	// Back to the default: only an element already routed elsewhere needs telling.
	if (!deviceId && !el.sinkId) return true
	try {
		await el.setSinkId(deviceId)
		return true
	} catch (err) {
		console.warn('Audio output device unavailable; using the system default:', err)
		return false
	}
}

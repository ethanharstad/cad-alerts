import { parseEmail, EmailParseError } from './parse';
import type { Alert } from '../shared/types';
import type { AlertStore } from './store';
import type { AlertGenerator } from './generator';
import type { AudioStore } from './audio';

/**
 * Default dedup window: a pre-alert at the same `(organization, address, city)`
 * as an existing alert newer than this span is treated as an update to that same
 * incident (its nature was revised) rather than a new alert. Measured from the
 * incident's first email, since an update keeps the original timestamp.
 */
export const DEFAULT_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/** The pre-alert intake payload, as delivered by the email handler. */
export interface PreAlertPayload {
	emailTo: string;
	emailFrom: string;
	emailText: string;
}

/**
 * A durable-step runner. In production this is the Cloudflare `WorkflowStep`
 * (`step.do`), which memoizes each step's result across retries and replays; in
 * tests it is a plain runner that just invokes the closure. `processPreAlert`
 * depends only on this shape, so it never imports the Workflow runtime.
 */
export interface StepRunner {
	do<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Everything `processPreAlert` needs from the outside world. Every adapter is
 * accepted, never constructed, so the pipeline runs end-to-end under fakes.
 * `nonRetryable` and `now` carry the two ambient runtime concerns — the
 * Workflow's non-retryable signal and the clock — without importing them.
 */
export interface PreAlertDeps {
	store: AlertStore;
	generator: AlertGenerator;
	audioStore: AudioStore;
	/** Build the error that tells the Workflow engine not to retry a doomed step. */
	nonRetryable: (message: string) => Error;
	/** The current time, in epoch milliseconds. */
	now: () => number;
	/**
	 * Dedup window in milliseconds: a matching alert (same org + address + city)
	 * newer than `now - dedupWindowMs` is updated in place instead of inserted.
	 * See {@link DEFAULT_DEDUP_WINDOW_MS}.
	 */
	dedupWindowMs: number;
}

/**
 * Process one pre-alert: resolve its organization, parse the email, generate the
 * spoken text and audio, store the audio, and record the alert. Orchestrates the
 * durable steps in a fixed order (the determinism the Workflow engine requires)
 * but owns no runtime dependency directly — the `step` runner and every adapter
 * arrive as arguments.
 *
 * @param alertId identifies this pre-alert; used as the alert's id and audio key.
 */
export async function processPreAlert(
	step: StepRunner,
	payload: PreAlertPayload,
	alertId: string,
	deps: PreAlertDeps,
): Promise<void> {
	const { org_id: orgId, tts_template: ttsTemplate } = await step.do('Get Org', async () => {
		const orgKey = payload.emailTo.split(',')[0].split('@')[0];
		const org = await deps.store.findOrgByKey(orgKey);
		if (!org) {
			throw deps.nonRetryable(`Org with key "${orgKey}" not found!`);
		}
		// Return plain JSON so the Workflow engine can memoize this step. The
		// org's token template drives the spoken text in "Generate Text" below.
		return { org_id: org.org_id, tts_template: org.tts_template };
	});

	const preAlert = await step.do('Parse Email', async () => {
		try {
			return parseEmail(payload.emailText);
		} catch (err) {
			if (err instanceof EmailParseError) {
				throw deps.nonRetryable(err.message);
			}
			throw err;
		}
	});

	const text = await step.do('Generate Text', async () => {
		return deps.generator.generateText(preAlert, ttsTemplate);
	});

	const audio = await step.do('Get Audio', async () => {
		return deps.generator.synthesizeSpeech(text);
	});

	const audioUrl = await step.do('Upload Audio', async () => {
		return deps.audioStore.put(alertId, audio);
	});

	await step.do('Save Record', async () => {
		const now = deps.now();
		// Multiple emails for one incident share a location; when the nature is
		// revised a fresh email arrives. If a recent alert at the same location
		// exists, update it in place rather than inserting a duplicate.
		const match = await deps.store.findRecentMatch(
			orgId,
			preAlert.address,
			preAlert.city,
			now - deps.dedupWindowMs,
		);

		if (match) {
			// Refresh the incident's details but keep its id and original
			// timestamp (so it holds its place in the recent list). The new
			// email's audio was uploaded under a fresh key; the superseded
			// object is left orphaned in R2 — cleanup is out of scope and the
			// AudioStore is write-only by design.
			await deps.store.updateAlert({
				...match,
				body: text,
				audio_url: audioUrl,
				source: payload.emailText,
				nature: preAlert.nature,
				latitude: preAlert.latitude,
				longitude: preAlert.longitude,
			});
			return;
		}

		const record: Alert = {
			alert_id: alertId,
			organization: orgId,
			body: text,
			audio_url: audioUrl,
			timestamp: now,
			source: payload.emailText,
			address: preAlert.address,
			city: preAlert.city,
			nature: preAlert.nature,
			latitude: preAlert.latitude,
			longitude: preAlert.longitude,
		};
		await deps.store.insertAlert(record);
	});
}

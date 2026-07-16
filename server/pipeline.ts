import { parseEmail, EmailParseError } from './parse';
import type { AlertStore } from './store';
import type { AlertGenerator } from './generator';
import type { AudioStore } from './audio';

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
	const orgId = await step.do('Get Org', async () => {
		const orgKey = payload.emailTo.split(',')[0].split('@')[0];
		const org = await deps.store.findOrgByKey(orgKey);
		if (!org) {
			throw deps.nonRetryable(`Org with key "${orgKey}" not found!`);
		}
		return org.org_id;
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
		return deps.generator.generateText(preAlert);
	});

	const audio = await step.do('Get Audio', async () => {
		return deps.generator.synthesizeSpeech(text);
	});

	const audioUrl = await step.do('Upload Audio', async () => {
		return deps.audioStore.put(alertId, audio);
	});

	await step.do('Save Record', async () => {
		await deps.store.insertAlert({
			alert_id: alertId,
			organization: orgId,
			body: text,
			audio_url: audioUrl,
			timestamp: deps.now(),
			source: payload.emailText,
			address: preAlert.address,
			city: preAlert.city,
			nature: preAlert.nature,
			latitude: preAlert.latitude,
			longitude: preAlert.longitude,
		});
	});
}

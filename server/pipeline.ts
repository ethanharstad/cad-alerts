import { parseEmail, EmailParseError } from './parse';
import type { Alert } from '../shared/types';
import type { AlertStore } from './store';
import type { AlertGenerator } from './generator';
import type { AudioStore } from './audio';
import { parseAllowedSenders, isSenderAllowed } from '../shared/senders';
import { CAP_WINDOW_MS, isActiveCap, type CapPeriod, type CapReporter } from './caps';
import { isPermanentApiError, isSpeakable, limitSpeechFields, limitSpokenText } from './speech';
import type { WorkflowStepConfig } from 'cloudflare:workers';

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
 * tests it is a plain runner that just invokes the closure (and ignores any
 * config). `processPreAlert` depends only on this shape, so it never imports the
 * Workflow runtime (the config type is a type-only import, erased at build).
 */
export interface StepRunner {
	do<T>(name: string, callback: () => Promise<T>): Promise<T>;
	do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
}

/**
 * Retry policy for "Synthesize & Upload Audio", the paid TTS call. Explicit
 * rather than the Workflow default so worst-case latency and spend are
 * predictable: at most 1 + 4 attempts (so at most 5 billed syntheses), backing
 * off 10s, 20s, 40s, 80s — about 2.5 minutes, long enough to ride out a short
 * rate-limit burst or upstream blip. The OpenAI client is built with
 * `maxRetries: 0` and a 40s timeout, so these are the only retries; the step
 * timeout leaves ample headroom over that for the R2 upload that follows.
 */
export const AUDIO_STEP_CONFIG = {
	retries: { limit: 4, delay: '10 seconds', backoff: 'exponential' },
	timeout: '90 seconds',
} satisfies WorkflowStepConfig;

/**
 * Retry policy for "Generate Text". In production the text is rendered locally
 * from the org's template, so a failure is almost always a deterministic bug
 * that would repeat; one retry covers a model-backed generator's transient
 * error without stalling on a doomed one.
 */
export const TEXT_STEP_CONFIG = {
	retries: { limit: 1, delay: '5 seconds', backoff: 'constant' },
	timeout: '60 seconds',
} satisfies WorkflowStepConfig;

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
	/** Where alerts that go over an org's soft volume cap are reported. */
	capReporter: CapReporter;
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
 * Process one pre-alert: resolve its organization (rejecting a sender it does
 * not allow), parse the email, stop early on an exact resend of a recent alert,
 * report any soft volume cap it exceeds, generate the spoken text and audio,
 * store the audio, and record the alert. Orchestrates the
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
	const org = await step.do('Get Org', async () => {
		const orgKey = payload.emailTo.split(',')[0].split('@')[0];
		const org = await deps.store.findOrgByKey(orgKey);
		if (!org) {
			throw deps.nonRetryable(`Org with key "${orgKey}" not found!`);
		}
		// Only listed senders may raise an alert; an empty list allows all, so
		// orgs that have not configured one keep working. Rejected before any
		// paid step runs, and non-retryable since a resend cannot change it.
		if (!isSenderAllowed(parseAllowedSenders(org.allowed_senders), payload.emailFrom)) {
			console.warn('pre-alert sender rejected', {
				orgKey,
				emailFrom: payload.emailFrom,
				alertId,
			});
			throw deps.nonRetryable(
				`Sender "${payload.emailFrom}" is not allowed for org "${orgKey}"`,
			);
		}
		// Return plain JSON so the Workflow engine can memoize this step. The
		// org's token template drives the spoken text in "Generate Text" below.
		return {
			org_id: org.org_id,
			org_key: org.org_key,
			tts_template: org.tts_template,
			alert_cap_hourly: org.alert_cap_hourly,
			alert_cap_monthly: org.alert_cap_monthly,
		};
	});
	const orgId = org.org_id;

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

	// An exact resend of an incident we already announced (a CAD resend loop, a
	// doubled forwarding rule) stops here, before any paid step: no synthesis,
	// no upload, no row change. A genuine revision — a changed nature or
	// location fix — differs from the match and goes on to be re-synthesized.
	const duplicate = await step.do('Check Duplicate', async () => {
		const match = await deps.store.findRecentMatch(
			orgId,
			preAlert.address,
			preAlert.city,
			deps.now() - deps.dedupWindowMs,
		);
		return (
			match !== undefined &&
			match.nature === preAlert.nature &&
			match.latitude === preAlert.latitude &&
			match.longitude === preAlert.longitude
		);
	});
	if (duplicate) return;

	// Soft caps: report an org that is over its hourly or monthly volume, but
	// deliver the alert regardless — a dropped dispatch is worse than the cost.
	await step.do('Check Caps', async () => {
		const caps: [CapPeriod, number | null][] = [
			['hourly', org.alert_cap_hourly],
			['monthly', org.alert_cap_monthly],
		];
		for (const [period, cap] of caps) {
			if (!isActiveCap(cap)) continue;
			// Alerts already in the window, plus this one.
			const count =
				(await deps.store.countAlertsSince(orgId, deps.now() - CAP_WINDOW_MS[period])) + 1;
			if (count > cap) {
				await deps.capReporter.capExceeded({
					orgId,
					orgKey: org.org_key,
					alertId,
					period,
					cap,
					count,
				});
			}
		}
	});

	const text = await step.do('Generate Text', TEXT_STEP_CONFIG, async () => {
		// Cap each field on its own first, so one oversized field cannot crowd
		// the location out of the alert. Only this speech copy is capped; the
		// stored record keeps the full parsed fields.
		const limitedFields = limitSpeechFields(preAlert);
		if (limitedFields.truncated.length > 0) {
			console.warn('pre-alert speech fields truncated', {
				alertId,
				orgKey: org.org_key,
				fields: limitedFields.truncated,
			});
		}
		const generated = await nonRetryableIfPermanent(deps, () =>
			deps.generator.generateText(limitedFields.fields, org.tts_template),
		);
		// Backstop cap on what reaches the paid TTS call. Deterministic, so a
		// retry or replay of this step always yields the same text.
		const limited = limitSpokenText(generated);
		if (limited.truncated) {
			console.warn('spoken alert text truncated', {
				alertId,
				orgKey: org.org_key,
				originalLength: generated.length,
				length: limited.text.length,
			});
		}
		if (!isSpeakable(limited.text)) {
			// Report only the length: the text is unbounded and the message is
			// persisted in Workflow state.
			throw deps.nonRetryable(
				`Generated alert text is blank (${generated.length} chars, no letters or digits)`,
			);
		}
		return limited.text;
	});

	// Synthesize and upload in one step, returning only the object key: a
	// step's return value is persisted in Workflow state (and capped at 1 MiB),
	// so the MP3 bytes must never be one. A retry re-synthesizes, which can pay
	// TTS twice if synthesis succeeded but the upload failed — an accepted trade.
	const audioUrl = await step.do('Synthesize & Upload Audio', AUDIO_STEP_CONFIG, async () => {
		const audio = await nonRetryableIfPermanent(deps, () =>
			deps.generator.synthesizeSpeech(text),
		);
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
			// timestamp (so it holds its place in the recent list). `updated_at`
			// does move, which is what carries the revision out to live
			// listeners — the SSE tail cursors on it. The new email's audio was
			// uploaded under a fresh key; the superseded object is left orphaned
			// in R2 — cleanup is out of scope and the AudioStore is write-only
			// by design.
			await deps.store.updateAlert({
				...match,
				body: text,
				audio_url: audioUrl,
				source: payload.emailText,
				nature: preAlert.nature,
				latitude: preAlert.latitude,
				longitude: preAlert.longitude,
				updated_at: now,
			});
			return;
		}

		const record: Alert = {
			alert_id: alertId,
			organization: orgId,
			body: text,
			audio_url: audioUrl,
			timestamp: now,
			// A fresh incident has never been revised, so the two clocks agree.
			updated_at: now,
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

/**
 * Run an upstream API call, converting a permanent failure (a 4xx other than
 * the transient ones; see {@link isPermanentApiError}) into the Workflow's non-retryable
 * error so the step fails at once instead of repeating a doomed, possibly paid,
 * call. Transient failures are rethrown unchanged for the step's retry policy.
 */
async function nonRetryableIfPermanent<T>(
	deps: Pick<PreAlertDeps, 'nonRetryable'>,
	call: () => Promise<T>,
): Promise<T> {
	try {
		return await call();
	} catch (err) {
		if (isPermanentApiError(err)) {
			const message = err instanceof Error ? err.message : String(err);
			throw deps.nonRetryable(`Upstream API rejected the request: ${message}`);
		}
		throw err;
	}
}

import PostalMime from 'postal-mime';
import { WorkflowStep, WorkflowEvent, WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import { createApp } from './api';
import { createD1Store } from './store';
import { createOpenAIGenerator } from './generator';
import { createR2AudioStore } from './audio';
import { processPreAlert } from './pipeline';

type WorkflowParams = {
	emailTo: string;
	emailFrom: string;
	emailText: string;
};

/**
 * The durable adapter for the pre-alert intake pipeline. Its only job is to wire
 * the real adapters to `env` — the D1 store, the OpenAI generator, the R2 audio
 * store, the Workflow's non-retryable signal, and the clock — and hand the
 * request to `processPreAlert`, which owns the actual orchestration. The
 * `step.do` durability boundaries live inside that module; the deep logic runs
 * the same whether a real step memoizes or a fake step just invokes.
 */
export class AlertWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		await processPreAlert(step, event.payload, event.instanceId, {
			store: createD1Store(this.env.db),
			generator: await createOpenAIGenerator(this.env),
			audioStore: createR2AudioStore(this.env.bucket),
			nonRetryable: (message) => new NonRetryableError(message),
			now: () => Date.now(),
		});
	}
}

export async function emailHandler(message: ForwardableEmailMessage, env: Env, _ctx: any) {
	const msg = await PostalMime.parse(message.raw);
	console.log({
		message: msg
	});
	const subject = msg.subject || "";
	if (subject.toLowerCase().includes("pre-alert")) {
		let instance = await env.alert_workflow.create({
			params: {
				emailFrom: msg.from?.address ?? '',
				emailTo: message.to,
				emailText: msg.text?.trim() ?? ''
			}
		});
	}
}


const app = createApp((env) => createD1Store(env.db));

export default {
	fetch: app.fetch,
	email: emailHandler
}

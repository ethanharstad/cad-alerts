import OpenAI from 'openai';

import type { PreAlert } from './parse';
import { PREALERT_PROMPT_INSTRUCTIONS, TTS_INSTRUCTIONS } from './prompts';
import { renderAlertText, DEFAULT_ADDRESS_TEMPLATE, type AddressTemplate } from './template';

/**
 * Turns a pre-alert into the spoken alert's parts. Two methods, not one, so the
 * pipeline can keep a durable checkpoint between the cheaper text generation and
 * the costlier speech synthesis — a synthesis retry never regenerates the text.
 */
export interface AlertGenerator {
	/** Generate the spoken alert text for a pre-alert. */
	generateText(preAlert: PreAlert): Promise<string>;
	/** Synthesize speech audio for already-generated alert text. */
	synthesizeSpeech(text: string): Promise<ArrayBuffer>;
}

/**
 * The production adapter: satisfies {@link AlertGenerator} with OpenAI, reached
 * through the Cloudflare AI Gateway. Owns the model ids and voice; the prompt
 * content stays in `prompts.ts`. Async because building the client awaits the
 * Secrets Store key and the gateway URL.
 */
export async function createOpenAIGenerator(env: Env): Promise<AlertGenerator> {
	const openai = new OpenAI({
		apiKey: await env.ai_key.get(),
		baseURL: await env.ai.gateway('sar').getUrl('openai'),
		defaultHeaders: {
			'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}`,
		},
	});
	return {
		async generateText(preAlert) {
			const response = await openai.responses.create({
				model: 'gpt-4.1-nano',
				instructions: PREALERT_PROMPT_INSTRUCTIONS,
				input: JSON.stringify({
					nature: preAlert.nature,
					address: preAlert.address,
					city: preAlert.city,
				}),
			});
			return response.output_text;
		},
		async synthesizeSpeech(text) {
			const mp3 = await openai.audio.speech.create({
				model: 'gpt-4o-mini-tts',
				voice: 'nova',
				instructions: TTS_INSTRUCTIONS,
				input: text,
			});
			return mp3.arrayBuffer();
		},
	};
}

/**
 * Deterministic text + OpenAI speech. The spoken text is assembled locally from
 * a template ({@link renderAlertText}) with no model call and no secrets, so the
 * same input always produces the same words; only speech synthesis still needs
 * OpenAI, which this delegates to {@link createOpenAIGenerator}. The template is
 * global for now (see {@link DEFAULT_ADDRESS_TEMPLATE}) but is passed in so it can
 * later come from per-org settings.
 */
export async function createDeterministicGenerator(
	env: Env,
	template: AddressTemplate = DEFAULT_ADDRESS_TEMPLATE,
): Promise<AlertGenerator> {
	const openai = await createOpenAIGenerator(env);
	return {
		async generateText(preAlert) {
			return renderAlertText(preAlert, template);
		},
		synthesizeSpeech: openai.synthesizeSpeech,
	};
}

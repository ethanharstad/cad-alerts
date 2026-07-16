import OpenAI from 'openai';

import type { PreAlert } from './parse';
import { PREALERT_PROMPT_INSTRUCTIONS, TTS_INSTRUCTIONS } from './prompts';

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

import type { PreAlert } from './parse';
import type { AlertGenerator } from './generator';

/** Canned outputs for {@link createFakeGenerator}. */
export interface FakeGeneratorOptions {
	text?: string;
	audio?: ArrayBuffer;
}

/**
 * The test adapter for {@link AlertGenerator}: returns canned text and audio so
 * pipeline tests can assert the generated body without reaching OpenAI. Imported
 * only by test files. `receivedTemplates` records the `ttsTemplate` argument of
 * every `generateText` call so tests can assert the org's template was threaded
 * through.
 */
export function createFakeGenerator(
	options: FakeGeneratorOptions = {},
): AlertGenerator & { receivedTemplates: (string | null | undefined)[] } {
	const text = options.text ?? 'spoken alert text';
	const audio = options.audio ?? new ArrayBuffer(8);
	const receivedTemplates: (string | null | undefined)[] = [];
	return {
		receivedTemplates,
		async generateText(_preAlert: PreAlert, ttsTemplate?: string | null) {
			receivedTemplates.push(ttsTemplate);
			return text;
		},
		async synthesizeSpeech(_text: string) {
			return audio;
		},
	};
}

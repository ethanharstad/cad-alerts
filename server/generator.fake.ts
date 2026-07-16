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
 * only by test files.
 */
export function createFakeGenerator(options: FakeGeneratorOptions = {}): AlertGenerator {
	const text = options.text ?? 'spoken alert text';
	const audio = options.audio ?? new ArrayBuffer(8);
	return {
		async generateText(_preAlert: PreAlert) {
			return text;
		},
		async synthesizeSpeech(_text: string) {
			return audio;
		},
	};
}

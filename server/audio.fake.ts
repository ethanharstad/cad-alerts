import type { AudioStore } from './audio';

/**
 * The test adapter for {@link AudioStore}: keeps stored audio in a Map and
 * returns the same `<alertId>.mp3` key the R2 adapter would. Imported only by
 * test files.
 */
export function createInMemoryAudioStore(): AudioStore {
	const objects = new Map<string, ArrayBuffer>();
	return {
		async put(alertId, audio) {
			const key = `${alertId}.mp3`;
			objects.set(key, audio);
			return key;
		},
	};
}

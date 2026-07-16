/**
 * Stores the generated audio for an alert and returns the URL by which it is
 * later served. Write-only for now — the read side (`GET /audio`) still reaches
 * R2 directly and can move behind this seam in a later pass.
 */
export interface AudioStore {
	/** Store `audio` for the given alert and return its stored URL/key. */
	put(alertId: string, audio: ArrayBuffer): Promise<string>;
}

/**
 * The production adapter: satisfies {@link AudioStore} against an R2 bucket. Owns
 * the object-key layout (`<alertId>.mp3`) and the audio content type.
 */
export function createR2AudioStore(bucket: R2Bucket): AudioStore {
	return {
		async put(alertId, audio) {
			const obj = await bucket.put(`${alertId}.mp3`, audio, {
				httpMetadata: { contentType: 'audio/mpeg' },
			});
			return obj.key;
		},
	};
}

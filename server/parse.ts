import { z } from 'zod';

/**
 * A pre-alert parsed out of a dispatch email body.
 *
 * The email body is a single pipe-delimited line of the form:
 *   `NATURE | ADDRESS:CITY | LATITUDE,LONGITUDE`
 * for example:
 *   `SICK PERSON | 1704 HAWKEYE DR #APT 104:BOONE | 42.036800,-93.868018`
 */
export const PreAlert = z.object({
	nature: z.string(),
	address: z.string(),
	city: z.string(),
	longitude: z.number(),
	latitude: z.number(),
});

export type PreAlert = z.infer<typeof PreAlert>;

/**
 * Thrown when an email body cannot be structurally parsed into a `PreAlert`.
 *
 * This is a plain error so the parser stays free of Cloudflare runtime imports
 * and can be unit tested under Node. Callers running inside a Workflow should
 * translate it into a `NonRetryableError` so malformed messages are not retried.
 */
export class EmailParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EmailParseError';
	}
}

/**
 * Parse a dispatch pre-alert email body into a structured `PreAlert`.
 *
 * @throws {EmailParseError} when the body does not match the expected shape.
 */
export function parseEmail(emailText: string | undefined | null): PreAlert {
	if (!emailText || !emailText.trim()) {
		throw new EmailParseError('Email body is empty');
	}

	const segments = emailText.split('|');
	if (segments.length < 3) {
		throw new EmailParseError(
			`Expected at least 3 pipe-delimited segments, got ${segments.length}`,
		);
	}

	const nature = segments[0].trim();
	if (!nature) {
		throw new EmailParseError('Missing nature of call');
	}

	const [addressPart, cityPart] = segments[1].split(':');
	const address = addressPart?.trim() ?? '';
	const city = cityPart?.trim() ?? '';
	if (!address) {
		throw new EmailParseError('Missing address');
	}
	if (!city) {
		throw new EmailParseError('Missing city (expected "ADDRESS:CITY")');
	}

	const coords = segments[segments.length - 1].split(',');
	if (coords.length !== 2) {
		throw new EmailParseError('Expected coordinates in "LATITUDE,LONGITUDE" form');
	}
	const latitude = Number(coords[0].trim());
	const longitude = Number(coords[1].trim());
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		throw new EmailParseError('Coordinates are not valid numbers');
	}

	return PreAlert.parse({ nature, address, city, latitude, longitude });
}

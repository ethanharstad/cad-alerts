/**
 * Soft per-organization volume caps — a backstop against a CAD resend loop or a
 * misrouted forwarding rule running up TTS cost. Caps are admin-only: they are
 * set by hand in the database (`alert_cap_hourly`, `alert_cap_monthly` on
 * `organizations`) and never exposed through the API.
 *
 * They are *soft*: going over never blocks an alert, because dropping a real
 * dispatch is worse than paying for one. Instead each alert over a cap is
 * handed to a {@link CapReporter}. Today that only logs; it is the seam where
 * operator alerting (email, push, …) will plug in.
 */

const HOUR_MS = 60 * 60 * 1000;

export type CapPeriod = 'hourly' | 'monthly';

/** Rolling window per cap period. "Monthly" is a rolling 30 days, so it needs no time zone. */
export const CAP_WINDOW_MS: Record<CapPeriod, number> = {
	hourly: HOUR_MS,
	monthly: 30 * 24 * HOUR_MS,
};

/** One alert that took an organization over one of its caps. */
export interface CapExceeded {
	orgId: string;
	orgKey: string;
	alertId: string;
	period: CapPeriod;
	cap: number;
	/** Alerts in the window including this one, so always greater than `cap`. */
	count: number;
}

/**
 * Where over-cap alerts are reported. Called once per over-cap alert per
 * period — every alert past the cap, not just the first — so a reporter that
 * pages someone should throttle on its side.
 */
export interface CapReporter {
	capExceeded(event: CapExceeded): Promise<void>;
}

/** The production reporter for now: a structured warning in the Worker logs. */
export function createLoggingCapReporter(log: (...args: unknown[]) => void = console.warn): CapReporter {
	return {
		async capExceeded(event) {
			log('alert cap exceeded', event);
		},
	};
}

/**
 * Whether a cap value is in force. Null means no cap; a non-positive or
 * non-integer value (a hand-edited typo) is ignored rather than flagging every
 * alert.
 */
export function isActiveCap(cap: number | null | undefined): cap is number {
	return typeof cap === 'number' && Number.isInteger(cap) && cap > 0;
}

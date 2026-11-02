/**
 * The page-wide "the real dispatch has started" signal. The dashboard's pager
 * monitor raises it when one of the department's tone sets is heard; anything
 * that plays alert audio outside the announcer — a manual replay from an alert
 * card — listens so it can stop too, rather than talk over the dispatcher.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** Tell every listener the pager has toned out. */
export function notifyPagerPreempt(): void {
	for (const listener of [...listeners]) {
		try {
			listener()
		} catch (err) {
			console.error('Pager preempt listener failed:', err)
		}
	}
}

/** Listen for pager preemption. Returns an unsubscribe function. */
export function onPagerPreempt(listener: Listener): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

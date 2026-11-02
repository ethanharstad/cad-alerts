import { ref, computed, type Ref } from 'vue'

import { matchSavedDevice, requestOutputAccess, type OutputDevice } from './outputDevice'

export interface DevicePickerOptions {
	/** Lists the devices to choose from (outputs, or inputs). */
	list: () => Promise<OutputDevice[]>
	/** The saved device id ('' is the system default) and its label. */
	deviceId: Ref<string>
	label: Ref<string>
	/** Shown when the browser refuses the media permission that reveals devices. */
	deniedMessage: string
	/** Shown when the permission is granted but there is nothing to pick. */
	emptyMessage: string
}

/**
 * The state behind a "pick a device" control in the settings screen, shared by
 * the alert output and the pager input: the list, the saved choice (followed
 * across re-issued ids), the permission request that reveals labels, and a
 * message line for the control.
 */
export function useDevicePicker(options: DevicePickerOptions) {
	const devices = ref<OutputDevice[]>([])
	const message = ref<string>('')

	// A saved device that isn't in the list is still offered, so the select shows
	// what is chosen; but only once we can see devices at all, since before
	// permission the list is empty for every device.
	const savedMissing = computed(
		() =>
			!!options.deviceId.value &&
			devices.value.length > 0 &&
			!devices.value.some((d) => d.deviceId === options.deviceId.value),
	)

	const refresh = async () => {
		try {
			devices.value = await options.list()
		} catch {
			devices.value = []
		}
		// Follow the saved device if the browser has re-issued its id.
		const resolved = await matchSavedDevice(
			async () => devices.value,
			options.deviceId.value,
			options.label.value,
		)
		if (resolved) options.deviceId.value = resolved
	}

	const find = async () => {
		message.value = ''
		try {
			await requestOutputAccess()
		} catch {
			message.value = options.deniedMessage
			return
		}
		await refresh()
		if (devices.value.length === 0) message.value = options.emptyMessage
	}

	const select = (deviceId: string) => {
		options.deviceId.value = deviceId
		options.label.value =
			devices.value.find((d) => d.deviceId === deviceId)?.label ??
			(deviceId ? options.label.value : '')
	}

	return { devices, message, savedMissing, refresh, find, select }
}

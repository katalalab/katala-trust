/**
 * Drop PRIVATE/IGNORE items before sidecar call.
 * Hosts keep private memory locally; sidecar only sees PUBLIC/MEDIATION.
 */

/**
 * @param {unknown} request
 * @returns {{ request: Record<string, unknown>, dropped_private: number, dropped_ignore: number }}
 */
export function sanitizeThinkRequest(request) {
	const req =
		request && typeof request === "object"
			? { .../** @type {Record<string, unknown>} */ (request) }
			: {};

	const items = Array.isArray(req.context_items) ? req.context_items : [];
	let dropped_private = 0;
	let dropped_ignore = 0;
	/** @type {unknown[]} */
	const kept = [];

	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const visibility = String(
			/** @type {Record<string, unknown>} */ (item).visibility || "PUBLIC",
		).toUpperCase();
		if (visibility === "PRIVATE") {
			dropped_private += 1;
			continue;
		}
		if (visibility === "IGNORE") {
			dropped_ignore += 1;
			continue;
		}
		kept.push(item);
	}

	return {
		request: {
			...req,
			context_items: kept,
			memory_mode: "none",
		},
		dropped_private,
		dropped_ignore,
	};
}

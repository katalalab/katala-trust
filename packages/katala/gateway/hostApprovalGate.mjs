/**
 * Host-side approval helper: map katala:think response → allow / block / ask-human.
 * Pure function; no I/O. Hosts decide how to enforce the decision.
 */

/**
 * @param {unknown} thinkResponse
 * @returns {{ decision: "allow" | "block" | "ask-human", reasons: string[], grade: string | null, status: string | null }}
 */
export function decideHostAction(thinkResponse) {
	const response =
		thinkResponse && typeof thinkResponse === "object"
			? /** @type {Record<string, unknown>} */ (thinkResponse)
			: {};

	const status = typeof response.status === "string" ? response.status : null;
	const safety =
		response.safety && typeof response.safety === "object"
			? /** @type {Record<string, unknown>} */ (response.safety)
			: {};
	const verification =
		response.verification && typeof response.verification === "object"
			? /** @type {Record<string, unknown>} */ (response.verification)
			: {};

	/** @type {string[]} */
	const reasons = [];
	const grade =
		typeof verification.grade === "string" ? verification.grade : null;

	if (status === "unsafe" || status === "rejected") {
		reasons.push(`status=${status}`);
		return { decision: "block", reasons, grade, status };
	}

	if (status === "needs-human" || safety.requires_human_approval === true) {
		reasons.push(
			status === "needs-human"
				? "status=needs-human"
				: "requires_human_approval",
		);
		return { decision: "ask-human", reasons, grade, status };
	}

	if (grade === "D" || grade === "F") {
		reasons.push(`grade=${grade}`);
		return { decision: "block", reasons, grade, status };
	}

	if (status === "ok") {
		return { decision: "allow", reasons, grade, status };
	}

	reasons.push("unrecognized-or-missing-status");
	return { decision: "ask-human", reasons, grade, status };
}

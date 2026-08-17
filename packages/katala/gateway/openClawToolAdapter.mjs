/**
 * Map a host tool-call payload into a katala:think request.
 * Hosts (OpenClaw-compatible) keep memory/execution; this only shapes stdin JSON.
 */

const TASK_MODES = new Set(["analyze", "mediate", "propose", "review"]);

function asString(value, fallback = "") {
	if (typeof value === "string") return value;
	if (value == null) return fallback;
	return String(value);
}

function asBool(value, fallback = false) {
	return typeof value === "boolean" ? value : fallback;
}

function normalizeMode(mode) {
	const m = asString(mode, "review").toLowerCase();
	return TASK_MODES.has(m) ? m : "review";
}

function normalizeVisibility(value) {
	const v = asString(value, "PUBLIC").toUpperCase();
	if (
		v === "IGNORE" ||
		v === "PRIVATE" ||
		v === "MEDIATION" ||
		v === "PUBLIC"
	) {
		return v;
	}
	return "PUBLIC";
}

/**
 * @param {unknown} toolArgs - OpenClaw/host tool arguments object
 * @param {{ hostName?: string, sessionId?: string, requestId?: string }} [meta]
 */
export function toolArgsToThinkRequest(toolArgs, meta = {}) {
	const args =
		toolArgs && typeof toolArgs === "object"
			? /** @type {Record<string, unknown>} */ (toolArgs)
			: {};
	const hostName = asString(
		meta.hostName || args.host_name || args.hostName,
		"openclaw-compatible-host",
	);
	const sessionId = asString(
		meta.sessionId || args.session_id || args.sessionId,
		"session",
	);
	const requestId = asString(
		meta.requestId || args.request_id || args.requestId,
		`tool-${Date.now()}`,
	);

	const goal = asString(
		args.goal || args.task || args.prompt,
		"Review the task and return a safe plan.",
	);
	const mode = normalizeMode(args.mode);

	/** @type {Array<Record<string, unknown>>} */
	const context_items = [];
	const rawItems = Array.isArray(args.context_items)
		? args.context_items
		: Array.isArray(args.contextItems)
			? args.contextItems
			: null;

	if (rawItems) {
		for (const [index, item] of rawItems.entries()) {
			if (!item || typeof item !== "object") continue;
			const row = /** @type {Record<string, unknown>} */ (item);
			const content = asString(row.content || row.text).trim();
			if (!content) continue;
			context_items.push({
				id: asString(row.id, `ctx-${index + 1}`).slice(0, 120),
				kind: asString(row.kind, "fact").slice(0, 60),
				content: content.slice(0, 20_000),
				visibility: normalizeVisibility(row.visibility),
				provenance: asString(row.provenance || row.source, "host-tool").slice(
					0,
					240,
				),
				ttl_seconds: Number.isFinite(Number(row.ttl_seconds ?? row.ttlSeconds))
					? Math.max(
							1,
							Math.min(
								31_536_000,
								Math.trunc(Number(row.ttl_seconds ?? row.ttlSeconds)),
							),
						)
					: 3600,
			});
		}
	} else if (typeof args.context === "string" && args.context.trim()) {
		context_items.push({
			id: "ctx-1",
			kind: "fact",
			content: args.context.trim().slice(0, 20_000),
			visibility: "PUBLIC",
			provenance: "host-tool",
			ttl_seconds: 3600,
		});
	}

	const caps =
		args.capabilities && typeof args.capabilities === "object"
			? /** @type {Record<string, unknown>} */ (args.capabilities)
			: {};

	const workspace =
		args.workspace && typeof args.workspace === "object"
			? /** @type {Record<string, unknown>} */ (args.workspace)
			: {};

	const readPaths = Array.isArray(workspace.read_paths)
		? workspace.read_paths
		: Array.isArray(workspace.readPaths)
			? workspace.readPaths
			: ["docs"];
	const writePaths = Array.isArray(workspace.write_paths)
		? workspace.write_paths
		: Array.isArray(workspace.writePaths)
			? workspace.writePaths
			: [];

	return {
		request_id: requestId.slice(0, 120),
		host: {
			name: hostName.slice(0, 120),
			session_id: sessionId.slice(0, 120),
		},
		task: {
			goal: goal.slice(0, 4_000),
			mode,
		},
		context_items,
		capabilities: {
			can_write: asBool(caps.can_write ?? caps.canWrite, false),
			can_shell: asBool(caps.can_shell ?? caps.canShell, false),
			can_network: asBool(caps.can_network ?? caps.canNetwork, false),
		},
		workspace: {
			read_paths: readPaths
				.map((p) => asString(p))
				.filter(Boolean)
				.slice(0, 64),
			write_paths: writePaths
				.map((p) => asString(p))
				.filter(Boolean)
				.slice(0, 16),
		},
		memory_mode: "none",
	};
}

/** JSON Schema-ish descriptor hosts can register as a tool. */
export const OPENCLAW_KATALA_THINK_TOOL = {
	name: "katala_think",
	description:
		"Stateless Katala trust/think sidecar. Returns verification grade and safe next actions. Does not write memory or execute shell.",
	parameters: {
		type: "object",
		properties: {
			goal: {
				type: "string",
				description: "Task goal for review/propose/analyze/mediate",
			},
			mode: {
				type: "string",
				enum: ["analyze", "mediate", "propose", "review"],
			},
			context: {
				type: "string",
				description: "Optional free-text context when context_items omitted",
			},
			context_items: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						kind: { type: "string" },
						content: { type: "string" },
						visibility: {
							type: "string",
							enum: ["IGNORE", "PRIVATE", "MEDIATION", "PUBLIC"],
						},
						provenance: { type: "string" },
						ttl_seconds: { type: "integer" },
					},
					required: ["content"],
				},
			},
			capabilities: {
				type: "object",
				properties: {
					can_write: { type: "boolean" },
					can_shell: { type: "boolean" },
					can_network: { type: "boolean" },
				},
			},
		},
		required: ["goal"],
	},
};

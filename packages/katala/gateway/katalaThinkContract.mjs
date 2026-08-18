import { pathToFileURL } from "node:url";
import { z } from "zod";
import { evaluateContextTrust } from "./thinkTrustBridge.mjs";

const visibilitySchema = z.enum(["IGNORE", "PRIVATE", "MEDIATION", "PUBLIC"]);
const taskModeSchema = z.enum(["analyze", "mediate", "propose", "review"]);
const responseStatusSchema = z.enum([
	"ok",
	"rejected",
	"unsafe",
	"needs-human",
]);
const actionKindSchema = z.enum([
	"reply",
	"plan",
	"patch-proposal",
	"policy-warning",
]);
const actionRiskSchema = z.enum(["low", "medium", "high"]);
const memoryModeSchema = z.enum(["none", "ephemeral", "distilled-export"]);
const gradeSchema = z.enum(["S", "A", "B", "C", "D", "F", "N/A"]);
const consensusSchema = z.enum([
	"unanimous",
	"majority",
	"tiebreaker",
	"deadlock",
	"none",
]);

const safeRelativePathSchema = z
	.string()
	.min(1)
	.max(240)
	.refine((value) => {
		if (value.includes("\0")) return false;
		if (
			value.startsWith("/") ||
			value.startsWith("\\") ||
			/^[A-Za-z]:/.test(value)
		)
			return false;
		const parts = value.split(/[\\/]+/);
		return parts.every(
			(part) => part.length > 0 && part !== "." && part !== "..",
		);
	}, "path must be a safe relative path");

const contextItemSchema = z.object({
	id: z.string().min(1).max(120),
	kind: z.string().min(1).max(60),
	content: z.string().min(1).max(20_000),
	visibility: visibilitySchema,
	provenance: z.string().min(1).max(240),
	ttl_seconds: z.number().int().positive().max(31_536_000),
});

const payloadSchema = z.record(z.string(), z.unknown());

const candidateActionSchema = z.object({
	kind: actionKindSchema,
	target: z.string().min(1).max(120),
	payload: payloadSchema.default({}),
	risk: actionRiskSchema,
});

const memoryExportSchema = z.object({
	kind: z.literal("distilled_fact"),
	content: z.string().min(1).max(1_000),
	visibility: z.enum(["MEDIATION", "PUBLIC"]),
	ttl_seconds: z.number().int().positive().max(31_536_000),
	confidence: z.number().min(0).max(1),
});

const trustAxesSchema = z.object({
	freshness: z.number().min(0).max(1),
	provenance: z.number().min(0).max(1),
	verification: z.number().min(0).max(1),
	accessibility: z.number().min(0).max(1),
});

const verificationSchema = z.object({
	enabled: z.boolean(),
	claim_count: z.number().int().min(0).max(128),
	composite_score: z.number().min(0).max(1).nullable(),
	grade: gradeSchema,
	consensus: consensusSchema,
	divergence: z.number().min(0).max(1),
	axes: trustAxesSchema.nullable(),
	caveats: z.array(z.string().min(1).max(200)).max(8),
	dissent: z
		.array(
			z.object({
				agent_id: z.string().min(1).max(120),
				score: z.number().min(0).max(1),
				reasoning: z.string().min(1).max(200),
			}),
		)
		.max(4),
	claim_summaries: z
		.array(
			z.object({
				id: z.string().min(1).max(120),
				grade: z.enum(["S", "A", "B", "C", "D", "F"]),
				composite_score: z.number().min(0).max(1),
			}),
		)
		.max(32),
});

export const katalaThinkRequestSchema = z.object({
	request_id: z.string().min(1).max(120),
	host: z.object({
		name: z.string().min(1).max(120),
		session_id: z.string().min(1).max(120),
	}),
	task: z.object({
		goal: z.string().min(1).max(4_000),
		mode: taskModeSchema,
	}),
	context_items: z.array(contextItemSchema).max(128).default([]),
	capabilities: z
		.object({
			can_write: z.boolean().default(false),
			can_shell: z.boolean().default(false),
			can_network: z.boolean().default(false),
		})
		.default({
			can_write: false,
			can_shell: false,
			can_network: false,
		}),
	workspace: z
		.object({
			read_paths: z.array(safeRelativePathSchema).max(64).default([]),
			write_paths: z.array(safeRelativePathSchema).max(16).default([]),
		})
		.default({
			read_paths: [],
			write_paths: [],
		}),
	memory_mode: memoryModeSchema.default("none"),
});

export const katalaThinkResponseSchema = z.object({
	request_id: z.string().min(1).max(120),
	status: responseStatusSchema,
	distilled_intent: z.string().min(1).max(500),
	reasoning_summary: z.array(z.string().min(1).max(200)).max(16),
	candidate_actions: z.array(candidateActionSchema).min(1).max(8),
	memory_exports: z.array(memoryExportSchema).max(8),
	safety: z.object({
		requires_human_approval: z.boolean(),
		forbidden_action_attempted: z.boolean(),
	}),
	verification: verificationSchema,
});

function normalizeGoal(goal) {
	const normalized = goal.replace(/\s+/g, " ").trim().slice(0, 240);
	return normalized.length > 0 ? normalized : "unspecified-goal";
}

function summarizeContext(contextItems) {
	const counts = {
		publicCount: 0,
		mediationCount: 0,
		privateCount: 0,
		ignoredCount: 0,
	};

	for (const item of contextItems) {
		if (item.visibility === "PUBLIC") counts.publicCount += 1;
		if (item.visibility === "MEDIATION") counts.mediationCount += 1;
		if (item.visibility === "PRIVATE") counts.privateCount += 1;
		if (item.visibility === "IGNORE") counts.ignoredCount += 1;
	}

	return counts;
}

function emptyVerification(caveat) {
	return {
		enabled: false,
		claim_count: 0,
		composite_score: null,
		grade: "N/A",
		consensus: "none",
		divergence: 0,
		axes: null,
		caveats: [caveat],
		dissent: [],
		claim_summaries: [],
	};
}

function buildOkAction(request, counts, verification) {
	const recommendedAction =
		request.task.mode === "review"
			? "stateless-review"
			: `stateless-${request.task.mode}-review`;

	return {
		kind: "plan",
		target: "host",
		payload: {
			mode: request.task.mode,
			recommended_action: recommendedAction,
			public_context_count: counts.publicCount,
			mediation_context_count: counts.mediationCount,
			private_context_withheld: counts.privateCount > 0,
			trust_grade: verification.grade,
			trust_score: verification.composite_score,
		},
		risk: verification.requires_human_approval ? "medium" : "low",
	};
}

function buildUnsafeAction(reasonCodes) {
	return {
		kind: "policy-warning",
		target: "host",
		payload: {
			reason_codes: reasonCodes,
			recommended_action: "retry-with-stateless-read-only-contract",
		},
		risk: "high",
	};
}

function buildNeedsHumanAction(verification) {
	return {
		kind: "plan",
		target: "host",
		payload: {
			recommended_action: "human-review-before-side-effects",
			trust_grade: verification.grade,
			trust_score: verification.composite_score,
			consensus: verification.consensus,
		},
		risk: "high",
	};
}

function buildRejectionAction(reasonCodes) {
	return {
		kind: "policy-warning",
		target: "host",
		payload: {
			reason_codes: reasonCodes,
			recommended_action: "fix-request-schema-and-retry",
		},
		risk: "medium",
	};
}

function buildReasoningSummary(request, counts, verification, extraReason) {
	const summary = [
		`mode:${request.task.mode}`,
		`public_context:${counts.publicCount}`,
		`mediation_context:${counts.mediationCount}`,
		`private_context_withheld:${counts.privateCount}`,
		`ignored_context:${counts.ignoredCount}`,
		`memory_mode:${request.memory_mode}`,
		`trust_grade:${verification.grade}`,
		`trust_consensus:${verification.consensus}`,
		"execution:read-only",
		"memory_exports:none",
	];

	if (extraReason) {
		summary.push(`status_reason:${extraReason}`);
	}

	return summary.slice(0, 16);
}

function toPublicVerification(evaluation) {
	return {
		enabled: evaluation.enabled,
		claim_count: evaluation.claim_count,
		composite_score: evaluation.composite_score,
		grade: evaluation.grade,
		consensus: evaluation.consensus,
		divergence: evaluation.divergence,
		axes: evaluation.axes,
		caveats: evaluation.caveats,
		dissent: evaluation.dissent,
		claim_summaries: evaluation.claim_summaries,
	};
}

export function createKatalaThinkResponse(request) {
	const counts = summarizeContext(request.context_items);
	const reasonCodes = [];

	if (request.capabilities.can_write)
		reasonCodes.push("write_capability_not_allowed");
	if (request.capabilities.can_shell)
		reasonCodes.push("shell_capability_not_allowed");
	if (request.capabilities.can_network)
		reasonCodes.push("network_capability_not_allowed");
	if (request.workspace.write_paths.length > 0)
		reasonCodes.push("write_paths_not_allowed");
	if (request.memory_mode !== "none")
		reasonCodes.push("memory_mode_not_supported_in_stateless_sidecar");

	const trustEvaluation = evaluateContextTrust(request.context_items);
	const verification = toPublicVerification(trustEvaluation);

	if (reasonCodes.length > 0) {
		return katalaThinkResponseSchema.parse({
			request_id: request.request_id,
			status: "unsafe",
			distilled_intent: normalizeGoal(request.task.goal),
			reasoning_summary: buildReasoningSummary(
				request,
				counts,
				verification,
				reasonCodes.join(","),
			),
			candidate_actions: [buildUnsafeAction(reasonCodes)],
			memory_exports: [],
			safety: {
				requires_human_approval: true,
				forbidden_action_attempted: true,
			},
			verification,
		});
	}

	if (trustEvaluation.requires_human_approval) {
		return katalaThinkResponseSchema.parse({
			request_id: request.request_id,
			status: "needs-human",
			distilled_intent: normalizeGoal(request.task.goal),
			reasoning_summary: buildReasoningSummary(
				request,
				counts,
				verification,
				"low_trust_or_consensus_deadlock",
			),
			candidate_actions: [buildNeedsHumanAction(verification)],
			memory_exports: [],
			safety: {
				requires_human_approval: true,
				forbidden_action_attempted: false,
			},
			verification,
		});
	}

	return katalaThinkResponseSchema.parse({
		request_id: request.request_id,
		status: "ok",
		distilled_intent: normalizeGoal(request.task.goal),
		reasoning_summary: buildReasoningSummary(request, counts, verification),
		candidate_actions: [buildOkAction(request, counts, trustEvaluation)],
		memory_exports: [],
		safety: {
			requires_human_approval: false,
			forbidden_action_attempted: false,
		},
		verification,
	});
}

export function createKatalaThinkRejection(rawRequestId, reasonCodes) {
	const response = {
		request_id:
			typeof rawRequestId === "string" && rawRequestId.trim().length > 0
				? rawRequestId.trim().slice(0, 120)
				: "invalid-request",
		status: "rejected",
		distilled_intent: "invalid katala-think request",
		reasoning_summary: [
			"request_validation:failed",
			`reason_codes:${reasonCodes.join(",")}`,
			"execution:read-only",
			"memory_exports:none",
		],
		candidate_actions: [buildRejectionAction(reasonCodes)],
		memory_exports: [],
		safety: {
			requires_human_approval: true,
			forbidden_action_attempted: true,
		},
		verification: emptyVerification("request_rejected_before_trust_scoring"),
	};

	return katalaThinkResponseSchema.parse(response);
}

export function createKatalaThinkResponseFromUnknown(input) {
	const parsed = katalaThinkRequestSchema.safeParse(input);
	if (!parsed.success) {
		const rawRequestId =
			input && typeof input === "object" && typeof input.request_id === "string"
				? input.request_id
				: undefined;
		const reasonCodes = parsed.error.issues.map(
			(issue) => `invalid_${issue.path.join("_") || "request"}`,
		);
		return createKatalaThinkRejection(
			rawRequestId,
			reasonCodes.length > 0 ? reasonCodes : ["invalid_request"],
		);
	}

	return createKatalaThinkResponse(parsed.data);
}

// A request this size is already far past what the contract accepts (128 context items,
// 20k chars each). Reading without a bound turned an oversized or never-closing stdin
// into unbounded heap growth in the host process rather than a rejected request.
const MAX_STDIN_BYTES = 8 * 1024 * 1024;

async function readAllFromStdin(stdin) {
	let data = "";
	for await (const chunk of stdin) {
		data += String(chunk);
    if (data.length > MAX_STDIN_BYTES) {
      throw new Error(
        `katala-think: stdin exceeded ${MAX_STDIN_BYTES} bytes; refusing to buffer further`,
      );
    }
	}
	return data;
}

export async function runKatalaThinkFromStdio({
	stdin = process.stdin,
	stdout = process.stdout,
} = {}) {
	try {
		const raw = await readAllFromStdin(stdin);
		const parsedInput = JSON.parse(raw || "{}");
		const response = createKatalaThinkResponseFromUnknown(parsedInput);
		stdout.write(`${JSON.stringify(response)}\n`);
		process.exitCode = response.status === "rejected" ? 1 : 0;
	} catch {
		const response = createKatalaThinkRejection("invalid-request", [
			"invalid_json",
		]);
		stdout.write(`${JSON.stringify(response)}\n`);
		process.exitCode = 1;
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
	await runKatalaThinkFromStdio();
}

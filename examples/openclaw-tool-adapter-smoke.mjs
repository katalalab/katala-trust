#!/usr/bin/env node
/**
 * Smoke: OpenClaw-style tool args → katala:think → verification present.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterUrl = pathToFileURL(
	path.join(root, "packages", "katala", "gateway", "openClawToolAdapter.mjs"),
).href;
const { toolArgsToThinkRequest, OPENCLAW_KATALA_THINK_TOOL } = await import(
	adapterUrl
);
const sanitizerUrl = pathToFileURL(
	path.join(root, "packages", "katala", "gateway", "contextSanitizer.mjs"),
).href;
const { sanitizeThinkRequest } = await import(sanitizerUrl);

if (OPENCLAW_KATALA_THINK_TOOL.name !== "katala_think") {
	console.error("tool descriptor name mismatch");
	process.exit(1);
}

const rawRequest = toolArgsToThinkRequest(
	{
		goal: "Decide whether to execute a write",
		mode: "review",
		context_items: [
			{
				id: "fact-1",
				kind: "fact",
				content: "Sidecar must stay read-only by default.",
				visibility: "PUBLIC",
				provenance: "primary-docs",
			},
			{
				id: "priv-1",
				kind: "note",
				content: "Host-only private note must not reach sidecar.",
				visibility: "PRIVATE",
				provenance: "host-memory",
			},
			{
				id: "gen-1",
				kind: "model-output",
				content: "Unverified generated suggestion to patch production.",
				visibility: "PUBLIC",
				provenance: "generated-llm",
				ttl_seconds: 600,
			},
		],
	},
	{
		hostName: "openclaw-smoke",
		sessionId: "adapter-smoke",
		requestId: "adapter-smoke-1",
	},
);

const { request, dropped_private } = sanitizeThinkRequest(rawRequest);
if (dropped_private < 1) {
	console.error("expected PRIVATE context to be dropped", {
		dropped_private,
		request,
	});
	process.exit(1);
}

const cli = path.join(
	root,
	"packages",
	"katala",
	"gateway",
	"katala-think.mjs",
);
const result = spawnSync(process.execPath, [cli], {
	cwd: root,
	input: JSON.stringify(request),
	encoding: "utf8",
});

if (result.status !== 0 && result.status !== 1) {
	console.error(result.stderr || result.stdout);
	process.exit(1);
}

const response = JSON.parse(result.stdout.trim());
if (!response.verification?.enabled) {
	console.error("missing verification", response);
	process.exit(1);
}

const gateUrl = pathToFileURL(
	path.join(root, "packages", "katala", "gateway", "hostApprovalGate.mjs"),
).href;
const { decideHostAction } = await import(gateUrl);
const decision = decideHostAction(response);
if (
	!decision.decision ||
	!["allow", "block", "ask-human"].includes(decision.decision)
) {
	console.error("invalid host decision", decision);
	process.exit(1);
}

console.log(
	JSON.stringify(
		{
			tool: OPENCLAW_KATALA_THINK_TOOL.name,
			dropped_private,
			status: response.status,
			grade: response.verification.grade,
			consensus: response.verification.consensus,
			requires_human_approval:
				response.safety?.requires_human_approval === true,
			host_decision: decision.decision,
			host_reasons: decision.reasons,
		},
		null,
		2,
	),
);

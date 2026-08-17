#!/usr/bin/env node
/**
 * Host-facing CLI: tool args JSON on stdin → think + host decision on stdout.
 * Exit codes: 0 allow, 2 ask-human, 3 block, 1 transport/parse error.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const load = async (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { toolArgsToThinkRequest, OPENCLAW_KATALA_THINK_TOOL } = await load(
	"packages/katala/gateway/openClawToolAdapter.mjs",
);
const { sanitizeThinkRequest } = await load(
	"packages/katala/gateway/contextSanitizer.mjs",
);
const { decideHostAction } = await load(
	"packages/katala/gateway/hostApprovalGate.mjs",
);

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const rawText = Buffer.concat(chunks).toString("utf8").trim();

let toolArgs = {};
let meta = {};
if (rawText) {
	try {
		const parsed = JSON.parse(rawText);
		if (parsed && typeof parsed === "object" && parsed.tool_args) {
			toolArgs = parsed.tool_args;
			meta = parsed.meta || {};
		} else {
			toolArgs = parsed;
		}
	} catch (err) {
		console.error(
			JSON.stringify({ error: "invalid_json", message: String(err) }),
		);
		process.exit(1);
	}
}

const rawRequest = toolArgsToThinkRequest(toolArgs, meta);
const { request, dropped_private, dropped_ignore } =
	sanitizeThinkRequest(rawRequest);
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
	console.error(
		JSON.stringify({
			error: "sidecar_failed",
			status: result.status,
			stderr: (result.stderr || "").slice(0, 500),
		}),
	);
	process.exit(1);
}

let response;
try {
	response = JSON.parse((result.stdout || "").trim());
} catch (err) {
	console.error(
		JSON.stringify({ error: "sidecar_unparseable", message: String(err) }),
	);
	process.exit(1);
}

const decision = decideHostAction(response);
const payload = {
	tool: OPENCLAW_KATALA_THINK_TOOL.name,
	host_decision: decision.decision,
	host_reasons: decision.reasons,
	dropped_private,
	dropped_ignore,
	status: response.status,
	grade: response.verification?.grade ?? null,
	consensus: response.verification?.consensus ?? null,
	requires_human_approval: response.safety?.requires_human_approval === true,
	think: response,
};

console.log(JSON.stringify(payload, null, 2));

if (decision.decision === "allow") process.exit(0);
if (decision.decision === "ask-human") process.exit(2);
process.exit(3);

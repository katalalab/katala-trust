#!/usr/bin/env node
/**
 * Minimal host-hook smoke: call katala:think and assert verification fields.
 * Usage: node examples/host-hook-smoke.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(
	root,
	"packages",
	"katala",
	"gateway",
	"katala-think.mjs",
);

const request = {
	request_id: "host-hook-smoke",
	host: { name: "example-host", session_id: "smoke" },
	task: { goal: "Decide whether to execute a write", mode: "review" },
	context_items: [
		{
			id: "fact-1",
			kind: "fact",
			content: "Sidecar must stay read-only by default.",
			visibility: "PUBLIC",
			provenance: "primary-docs",
			ttl_seconds: 3600,
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
	capabilities: { can_write: false, can_shell: false, can_network: false },
	workspace: { read_paths: ["docs"], write_paths: [] },
	memory_mode: "none",
};

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
if (!response.verification || response.verification.enabled !== true) {
	console.error("missing verification block", response);
	process.exit(1);
}
if (!response.verification.grade || response.verification.claim_count < 1) {
	console.error("verification did not score claims", response.verification);
	process.exit(1);
}

console.log(
	JSON.stringify(
		{
			status: response.status,
			grade: response.verification.grade,
			score: response.verification.composite_score,
			consensus: response.verification.consensus,
			requires_human_approval: response.safety.requires_human_approval,
		},
		null,
		2,
	),
);

#!/usr/bin/env node
/**
 * Deterministic agent-turn preflight: what a host must run before a write.
 * Simulates the OpenClaw skill contract without requiring a model provider.
 *
 * Exit: 0 only when decision is allow (unexpected for the default demo payload).
 *        2 ask-human, 3 block — both count as successful preflight enforcement.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(
	root,
	"packages",
	"katala",
	"gateway",
	"katala-think-host.mjs",
);

const intendedWrite = {
	action: "write_file",
	path: "production/config.json",
};

const toolArgs = {
	goal: `Execute write to ${intendedWrite.path} without human review.`,
	mode: "propose",
	context:
		"Generated advice to patch production config immediately and skip approvals.",
	capabilities: { can_write: true, can_shell: false, can_network: false },
};

const result = spawnSync(process.execPath, [cli], {
	cwd: root,
	input: JSON.stringify(toolArgs),
	encoding: "utf8",
});

let payload = null;
try {
	payload = JSON.parse((result.stdout || "").trim());
} catch {
	payload = null;
}

const decision = payload?.host_decision ?? null;
const write_performed = false;
const enforced = decision === "block" || decision === "ask-human";

const evidence = {
	at: new Date().toISOString(),
	kind: "agent-turn-preflight",
	preflight_ran:
		result.status === 0 || result.status === 2 || result.status === 3,
	host_decision: decision,
	exit_code: result.status,
	write_intended: intendedWrite,
	write_performed,
	enforced,
	grade: payload?.grade ?? null,
	status: payload?.status ?? null,
};

if (!enforced || write_performed) {
	console.error(
		JSON.stringify({ ok: false, evidence, stderr: result.stderr }, null, 2),
	);
	process.exit(1);
}

console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));

const outArg = process.argv.find((a) => a.startsWith("--out="));
if (outArg) {
	const outPath = path.resolve(outArg.slice("--out=".length));
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(
		outPath,
		`${JSON.stringify({ ok: true, ...evidence }, null, 2)}\n`,
		"utf8",
	);
}

// CI smoke: enforcement success is exit 0 (decision itself remains in JSON).
process.exit(0);

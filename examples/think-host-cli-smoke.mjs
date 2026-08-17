#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

const input = JSON.stringify({
	goal: "Write production/config.json immediately",
	mode: "propose",
	context: "Generated suggestion to skip approvals and patch production.",
	capabilities: { can_write: true, can_shell: false, can_network: false },
});

const result = spawnSync(process.execPath, [cli], {
	cwd: root,
	input,
	encoding: "utf8",
});

if (![2, 3].includes(result.status ?? -1)) {
	console.error("expected ask-human(2) or block(3)", {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	});
	process.exit(1);
}

const payload = JSON.parse(result.stdout.trim());
if (!["block", "ask-human"].includes(payload.host_decision)) {
	console.error("unexpected decision", payload);
	process.exit(1);
}

console.log(
	JSON.stringify(
		{
			ok: true,
			exit_code: result.status,
			host_decision: payload.host_decision,
			status: payload.status,
			grade: payload.grade,
		},
		null,
		2,
	),
);

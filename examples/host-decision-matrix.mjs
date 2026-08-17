#!/usr/bin/env node
/**
 * Print host decisions for canned think responses (no sidecar spawn).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gateUrl = pathToFileURL(
	path.join(root, "packages", "katala", "gateway", "hostApprovalGate.mjs"),
).href;
const { decideHostAction } = await import(gateUrl);

const cases = [
	{
		name: "clean-ok",
		response: {
			status: "ok",
			safety: { requires_human_approval: false },
			verification: { grade: "A" },
		},
	},
	{
		name: "needs-human",
		response: { status: "needs-human", verification: { grade: "C" } },
	},
	{
		name: "unsafe",
		response: { status: "unsafe", verification: { grade: "F" } },
	},
	{
		name: "grade-F-ok-status",
		response: { status: "ok", verification: { grade: "F" } },
	},
	{ name: "garbage", response: null },
];

const rows = cases.map(({ name, response }) => {
	const d = decideHostAction(response);
	return { name, decision: d.decision, reasons: d.reasons };
});

const unexpected = rows.filter((r) => {
	if (r.name === "clean-ok") return r.decision !== "allow";
	if (r.name === "needs-human" || r.name === "garbage")
		return r.decision !== "ask-human";
	if (r.name === "unsafe" || r.name === "grade-F-ok-status")
		return r.decision !== "block";
	return true;
});

if (unexpected.length) {
	console.error("decision matrix mismatch", unexpected);
	process.exit(1);
}

console.log(JSON.stringify({ ok: true, cases: rows }, null, 2));

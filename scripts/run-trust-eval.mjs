#!/usr/bin/env node
/**
 * Rank-5 labeled trust eval runner.
 * Scores each JSONL claim via thinkTrustBridge and checks expected grade bands.
 *
 * Usage:
 *   node scripts/run-trust-eval.mjs
 *   node scripts/run-trust-eval.mjs --min-pass-rate=0.8
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateContextTrust } from "../packages/katala/gateway/thinkTrustBridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evalPath = path.join(root, "evals", "trust-claims-v1.jsonl");

function parseArgs(argv) {
	let minPassRate = 0.8;
	for (const arg of argv) {
		if (arg.startsWith("--min-pass-rate=")) {
			minPassRate = Number(arg.slice("--min-pass-rate=".length));
		}
	}
	return { minPassRate };
}

function loadCases(filePath) {
	return readFileSync(filePath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			const row = JSON.parse(line);
			if (!row.id || !Array.isArray(row.expect_grades)) {
				throw new Error(`invalid eval row at ${index + 1}`);
			}
			return row;
		});
}

function scoreCase(row) {
	const evaluation = evaluateContextTrust([
		{
			id: row.id,
			kind: row.kind,
			content: row.content,
			visibility: row.visibility,
			provenance: row.provenance,
			ttl_seconds: 3600,
		},
	]);
	return {
		id: row.id,
		band: row.band,
		expected: row.expect_grades,
		grade: evaluation.grade,
		score: evaluation.composite_score,
		consensus: evaluation.consensus,
		pass: row.expect_grades.includes(evaluation.grade),
	};
}

const { minPassRate } = parseArgs(process.argv.slice(2));
const cases = loadCases(evalPath);
const results = cases.map(scoreCase);
const passed = results.filter((row) => row.pass).length;
const passRate = passed / results.length;

const byBand = {};
for (const row of results) {
	if (!byBand[row.band]) byBand[row.band] = { pass: 0, total: 0 };
	byBand[row.band].total += 1;
	if (row.pass) byBand[row.band].pass += 1;
}

const summary = {
	eval: "trust-claims-v1",
	total: results.length,
	passed,
	pass_rate: Math.round(passRate * 1000) / 1000,
	min_pass_rate: minPassRate,
	by_band: byBand,
	failures: results
		.filter((row) => !row.pass)
		.map((row) => ({
			id: row.id,
			band: row.band,
			grade: row.grade,
			score: row.score,
			expected: row.expected,
		})),
};

console.log(JSON.stringify(summary, null, 2));

if (passRate + 1e-9 < minPassRate) {
	console.error(
		`trust eval failed: pass_rate=${summary.pass_rate} < min_pass_rate=${minPassRate}`,
	);
	process.exit(1);
}

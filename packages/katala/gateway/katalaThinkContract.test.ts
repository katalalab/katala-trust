import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	createKatalaThinkResponse,
	createKatalaThinkResponseFromUnknown,
	katalaThinkRequestSchema,
	katalaThinkResponseSchema,
	runKatalaThinkFromStdio,
} from "./katalaThinkContract.mjs";

const cliPath = path.join(
	process.cwd(),
	"packages",
	"katala",
	"gateway",
	"katala-think.mjs",
);
const cleanupDirs: string[] = [];

const baseRequest = {
	request_id: "req-001",
	host: {
		name: "openclaw-compatible-host",
		session_id: "sess-001",
	},
	task: {
		goal: "Review the current task and propose the safest next step.",
		mode: "review",
	},
	context_items: [
		{
			id: "ctx-public-1",
			kind: "fact",
			content: "Project uses a stateless sidecar contract.",
			visibility: "PUBLIC",
			provenance: "docs/contract",
			ttl_seconds: 3600,
		},
	],
	capabilities: {
		can_write: false,
		can_shell: false,
		can_network: false,
	},
	workspace: {
		read_paths: ["docs", "packages", "src"],
		write_paths: [],
	},
	memory_mode: "none",
} as const;

afterEach(async () => {
	process.exitCode = undefined;
	await Promise.all(
		cleanupDirs.splice(0).map(async (dir) => {
			await rm(dir, { recursive: true, force: true });
		}),
	);
});

function runCli(
	input: unknown,
	cwd = process.cwd(),
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cliPath], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ code, stdout, stderr });
		});

		child.stdin.write(JSON.stringify(input));
		child.stdin.end();
	});
}

describe("katalaThinkRequestSchema", () => {
	it("accepts a valid stateless sidecar request", () => {
		const parsed = katalaThinkRequestSchema.parse(baseRequest);
		expect(parsed.memory_mode).toBe("none");
		expect(parsed.capabilities.can_write).toBe(false);
		expect(parsed.workspace.write_paths).toEqual([]);
	});

	it("rejects unsafe path traversal at schema level", () => {
		expect(() =>
			katalaThinkRequestSchema.parse({
				...baseRequest,
				workspace: {
					...baseRequest.workspace,
					read_paths: ["../secrets"],
				},
			}),
		).toThrow();
	});

	it("rejects absolute paths at schema level", () => {
		expect(() =>
			katalaThinkRequestSchema.parse({
				...baseRequest,
				workspace: {
					...baseRequest.workspace,
					read_paths: ["C:\\absolute"],
				},
			}),
		).toThrow();
	});
});

describe("createKatalaThinkResponse", () => {
	it("produces a schema-valid response for a valid stateless request", () => {
		const request = katalaThinkRequestSchema.parse(baseRequest);
		const response = katalaThinkResponseSchema.parse(
			createKatalaThinkResponse(request),
		);

		expect(response.request_id).toBe(request.request_id);
		expect(response.status).toBe("ok");
		expect(response.memory_exports).toEqual([]);
		expect(response.safety.requires_human_approval).toBe(false);
		expect(response.candidate_actions[0]?.payload?.recommended_action).toBe(
			"stateless-review",
		);
		expect(response.verification.enabled).toBe(true);
		expect(response.verification.claim_count).toBe(1);
		expect(response.verification.grade).not.toBe("N/A");
		expect(response.verification.axes).not.toBeNull();
	});

	it("scores generated provenance lower and may require human approval", () => {
		const request = katalaThinkRequestSchema.parse({
			...baseRequest,
			context_items: [
				{
					id: "ctx-generated-1",
					kind: "model-output",
					content: "Unverified model claim about market direction.",
					visibility: "PUBLIC",
					provenance: "generated-llm-summary",
					ttl_seconds: 3600,
				},
			],
		});

		const response = createKatalaThinkResponse(request);
		expect(response.verification.enabled).toBe(true);
		expect(response.verification.claim_count).toBe(1);
		expect(["C", "D", "F"]).toContain(response.verification.grade);
		expect(response.verification.caveats.join(",")).toMatch(
			/generated|local_dual/,
		);
	});

	it("never includes PRIVATE context content in verification payloads", () => {
		const privateSecret = "PRIVATE-SECRET-DO-NOT-LEAK";
		const request = katalaThinkRequestSchema.parse({
			...baseRequest,
			context_items: [
				...baseRequest.context_items,
				{
					id: "ctx-private-1",
					kind: "note",
					content: privateSecret,
					visibility: "PRIVATE",
					provenance: "user/private-note",
					ttl_seconds: 3600,
				},
			],
		});

		const response = createKatalaThinkResponse(request);
		const serialized = JSON.stringify(response);

		expect(serialized).not.toContain(privateSecret);
		expect(
			response.verification.claim_summaries.every(
				(item) => item.id !== "ctx-private-1",
			),
		).toBe(true);
	});
	it("marks requests with write paths as unsafe to preserve read-only execution", () => {
		const request = katalaThinkRequestSchema.parse({
			...baseRequest,
			workspace: {
				...baseRequest.workspace,
				write_paths: ["docs"],
			},
		});

		const response = createKatalaThinkResponse(request);

		expect(response.status).toBe("unsafe");
		expect(response.safety.requires_human_approval).toBe(true);
		expect(response.memory_exports).toEqual([]);
		expect(response.candidate_actions[0]?.payload?.reason_codes).toContain(
			"write_paths_not_allowed",
		);
	});

	it("never leaks PRIVATE context into response fields or memory exports", () => {
		const privateSecret = "PRIVATE-SECRET-DO-NOT-LEAK";
		const request = katalaThinkRequestSchema.parse({
			...baseRequest,
			context_items: [
				...baseRequest.context_items,
				{
					id: "ctx-private-1",
					kind: "note",
					content: privateSecret,
					visibility: "PRIVATE",
					provenance: "user/private-note",
					ttl_seconds: 3600,
				},
			],
		});

		const response = createKatalaThinkResponse(request);
		const serialized = JSON.stringify(response);

		expect(serialized).not.toContain(privateSecret);
		expect(response.memory_exports).toEqual([]);
	});

	it("flags shell, network, and unsupported memory requests as unsafe", () => {
		const request = katalaThinkRequestSchema.parse({
			...baseRequest,
			capabilities: {
				can_write: false,
				can_shell: true,
				can_network: true,
			},
			memory_mode: "ephemeral",
		});

		const response = createKatalaThinkResponse(request);
		const reasonCodes = response.candidate_actions[0]?.payload
			?.reason_codes as string[];

		expect(response.status).toBe("unsafe");
		expect(reasonCodes).toContain("shell_capability_not_allowed");
		expect(reasonCodes).toContain("network_capability_not_allowed");
		expect(reasonCodes).toContain(
			"memory_mode_not_supported_in_stateless_sidecar",
		);
	});
});

describe("createKatalaThinkResponseFromUnknown", () => {
	it("returns a structured rejection without leaking malformed input", () => {
		const response = createKatalaThinkResponseFromUnknown({
			request_id: "bad-req",
			host: {},
			task: {},
		});

		expect(response.status).toBe("rejected");
		expect(response.request_id).toBe("bad-req");
		expect(response.candidate_actions[0]?.kind).toBe("policy-warning");
	});
});

describe("runKatalaThinkFromStdio", () => {
	it("writes a structured success response for valid stdin JSON", async () => {
		const stdoutChunks: string[] = [];
		const stdout = new Writable({
			write(chunk, _encoding, callback) {
				stdoutChunks.push(String(chunk));
				callback();
			},
		});

		await runKatalaThinkFromStdio({
			stdin: Readable.from([
				JSON.stringify(baseRequest),
			]) as unknown as typeof process.stdin,
			stdout: stdout as unknown as typeof process.stdout,
		});

		const response = katalaThinkResponseSchema.parse(
			JSON.parse(stdoutChunks.join("")),
		);
		expect(response.status).toBe("ok");
		expect(process.exitCode).toBe(0);
	});

	it("writes a structured rejection response for malformed stdin JSON", async () => {
		const stdoutChunks: string[] = [];
		const stdout = new Writable({
			write(chunk, _encoding, callback) {
				stdoutChunks.push(String(chunk));
				callback();
			},
		});

		await runKatalaThinkFromStdio({
			stdin: Readable.from(["{not-json"]) as unknown as typeof process.stdin,
			stdout: stdout as unknown as typeof process.stdout,
		});

		const response = katalaThinkResponseSchema.parse(
			JSON.parse(stdoutChunks.join("")),
		);
		expect(response.status).toBe("rejected");
		expect(process.exitCode).toBe(1);
	});

	it("treats empty stdin as a rejected request instead of executing anything", async () => {
		const stdoutChunks: string[] = [];
		const stdout = new Writable({
			write(chunk, _encoding, callback) {
				stdoutChunks.push(String(chunk));
				callback();
			},
		});

		await runKatalaThinkFromStdio({
			stdin: Readable.from([]) as unknown as typeof process.stdin,
			stdout: stdout as unknown as typeof process.stdout,
		});

		const response = katalaThinkResponseSchema.parse(
			JSON.parse(stdoutChunks.join("")),
		);
		expect(response.status).toBe("rejected");
		expect(response.request_id).toBe("invalid-request");
		expect(process.exitCode).toBe(1);
	});
});

describe("katala-think CLI", () => {
	it("processes stdin/stdout JSON without creating files in the working directory", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "katala-think-"));
		cleanupDirs.push(tempDir);

		expect(await readdir(tempDir)).toEqual([]);

		const result = await runCli(baseRequest, tempDir);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");

		const response = katalaThinkResponseSchema.parse(JSON.parse(result.stdout));
		expect(response.request_id).toBe(baseRequest.request_id);
		expect(await readdir(tempDir)).toEqual([]);
	});

	it("returns structured rejection JSON for invalid input", async () => {
		const result = await runCli({ invalid: true });

		expect(result.code).toBe(1);
		expect(result.stderr).toBe("");

		const response = katalaThinkResponseSchema.parse(JSON.parse(result.stdout));
		expect(response.status).toBe("rejected");
		expect(response.safety.requires_human_approval).toBe(true);
	});
});

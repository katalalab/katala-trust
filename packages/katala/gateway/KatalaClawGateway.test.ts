import { afterEach, describe, expect, it } from "vitest";
import { createDefaultVector } from "../core/IdentityVector";
import { KatalaClawGateway } from "./KatalaClawGateway";

const LOCAL_PREFIXES = ["127.0.0.1", "::ffff:127.0.0.1", "::1"];

describe("KatalaClawGateway", () => {
	let gateway: KatalaClawGateway | null = null;

	afterEach(async () => {
		if (gateway) {
			await gateway.stopAsync();
			gateway = null;
		}
	});

	async function startLocalGateway(peerTokens?: string[]) {
		gateway = new KatalaClawGateway({
			port: 0,
			trustedTailscalePrefixes: LOCAL_PREFIXES,
			peerTokens: peerTokens ?? [],
			requireToken: (peerTokens?.length ?? 0) > 0,
		});
		const port = await gateway.startAsync();
		return port;
	}

	it("serves /health for trusted local test prefixes", async () => {
		const port = await startLocalGateway();
		const res = await fetch(`http://127.0.0.1:${port}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; bridge: string };
		expect(body.status).toBe("active");
		expect(body.bridge).toBe("Katala-Claw");
	});

	it("rejects mediation without peer token when tokens are required", async () => {
		const port = await startLocalGateway(["gateway-secret"]);
		const res = await fetch(`http://127.0.0.1:${port}/synergy/mediate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				user_a: { user_id: "a", identity_vector: createDefaultVector() },
				user_b: { user_id: "b", identity_vector: createDefaultVector() },
			}),
		});
		expect(res.status).toBe(403);
	});

	it("mediates with a valid peer token", async () => {
		const port = await startLocalGateway(["gateway-secret"]);
		const res = await fetch(`http://127.0.0.1:${port}/synergy/mediate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer gateway-secret",
			},
			body: JSON.stringify({
				user_a: { user_id: "sirokuma", identity_vector: createDefaultVector() },
				user_b: { user_id: "kani", identity_vector: createDefaultVector() },
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			synergy: { agent_id_a: string; agent_id_b: string; score: number };
		};
		expect(body.synergy.agent_id_a).toBe("sirokuma");
		expect(body.synergy.agent_id_b).toBe("kani");
		expect(typeof body.synergy.score).toBe("number");
	});

	it("returns 422 for invalid mediation envelopes", async () => {
		const port = await startLocalGateway();
		const res = await fetch(`http://127.0.0.1:${port}/synergy/mediate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ user_a: {}, user_b: {} }),
		});
		expect(res.status).toBe(422);
	});
});

import { describe, expect, it } from "vitest";
import { createDefaultVector } from "../IdentityVector";
import { LocalMediationManager } from "../LocalMediationManager";

describe("LocalMediationManager", () => {
	const manager = new LocalMediationManager();

	it("mediates an identity-vector synergy request", async () => {
		const result = await manager.mediate({
			user_a: { user_id: "sirokuma", identity_vector: createDefaultVector() },
			user_b: { user_id: "kani", identity_vector: createDefaultVector() },
		});

		expect(result.synergy.agent_id_a).toBe("sirokuma");
		expect(result.synergy.agent_id_b).toBe("kani");
		expect(typeof result.synergy.score).toBe("number");
	});

	it("accepts Tailscale CGNAT addresses and rejects public IPs", async () => {
		expect(await manager.verifyIdentity("100.64.0.1")).toBe(true);
		expect(await manager.verifyIdentity("fd7a:115c:a1e0::1")).toBe(true);
		expect(await manager.verifyIdentity("100.63.255.255")).toBe(false);
		expect(await manager.verifyIdentity("203.0.113.10")).toBe(false);
		expect(await manager.verifyIdentity("127.0.0.1")).toBe(false);
	});
});

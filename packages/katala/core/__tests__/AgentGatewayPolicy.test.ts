import { describe, expect, it } from "vitest";
import { createDefaultVector } from "../IdentityVector";
import {
	createHumanApprovalMediationRequest,
	extractBearerToken,
	isTrustedTailnetAddress,
	parseGatewayTokens,
	validateMediationEnvelope,
	verifyPeerRequest,
} from "../AgentGatewayPolicy";

describe("AgentGatewayPolicy", () => {
	it("extracts bearer tokens and parses env token lists", () => {
		expect(extractBearerToken({ authorization: "Bearer secret" })).toBe(
			"secret",
		);
		expect(parseGatewayTokens("a, b ,,c")).toEqual(["a", "b", "c"]);
	});

	it("accepts Tailscale CGNAT range and rejects adjacent public 100/8", () => {
		expect(isTrustedTailnetAddress("100.64.0.1")).toBe(true);
		expect(isTrustedTailnetAddress("100.127.255.255")).toBe(true);
		expect(isTrustedTailnetAddress("100.63.255.255")).toBe(false);
		expect(isTrustedTailnetAddress("100.128.0.1")).toBe(false);
		expect(isTrustedTailnetAddress("203.0.113.10")).toBe(false);
		expect(isTrustedTailnetAddress("fd7a:115c:a1e0::1")).toBe(true);
	});

	it("requires trusted tailnet address and peer token when configured", () => {
		const config = { acceptedTokens: ["secret"], requireToken: true };

		expect(
			verifyPeerRequest(
				{
					remoteAddress: "100.64.0.1",
					headers: { authorization: "Bearer secret" },
				},
				config,
			).ok,
		).toBe(true);
		expect(
			verifyPeerRequest({ remoteAddress: "100.64.0.1", headers: {} }, config)
				.reason,
		).toBe("missing-peer-token");
		expect(
			verifyPeerRequest(
				{
					remoteAddress: "203.0.113.1",
					headers: { authorization: "Bearer secret" },
				},
				config,
			).reason,
		).toBe("remote-address-outside-tailnet");
	});

	it("validates mediation envelopes before execution", () => {
		const request = {
			user_a: { user_id: "sirokuma", identity_vector: createDefaultVector() },
			user_b: { user_id: "kani", identity_vector: createDefaultVector() },
		};

		expect(validateMediationEnvelope(request)).toEqual(request);
		expect(() =>
			validateMediationEnvelope({ user_a: {}, user_b: {} }),
		).toThrow();
	});

	it("creates a human-in-the-loop mediation request", () => {
		const request = {
			user_a: { user_id: "sirokuma", identity_vector: createDefaultVector() },
			user_b: { user_id: "kani", identity_vector: createDefaultVector() },
		};

		const approval = createHumanApprovalMediationRequest(
			request,
			"2026-06-28T00:00:00.000Z",
		);

		expect(approval.status).toBe("pending-human-approval");
		expect(approval.requesterAgentId).toBe("sirokuma");
		expect(approval.targetAgentId).toBe("kani");
	});
});

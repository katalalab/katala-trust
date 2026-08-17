import { describe, expect, it } from "vitest";
import { createDefaultVector } from "../IdentityVector";
import {
	approveHumanReveal,
	createAgentSurfaceProfile,
	negotiateSurfaceConnection,
	scoreSurfaceCompatibility,
} from "../SurfaceConnection";

describe("SurfaceConnection", () => {
	function vector() {
		const value = createDefaultVector();
		value.values = ["trust", "shipping"];
		value.professionalFocus = ["ai infrastructure"];
		value.meta.confidenceScore = 1;
		value.socialEnergy.preferredTone = "professional";
		return value;
	}

	it("exchanges public profiles without exposing raw vectors", () => {
		const profile = createAgentSurfaceProfile(
			"sirokuma",
			"Nicolas",
			vector(),
			"medium",
			"jp",
		);

		expect(profile.agentId).toBe("sirokuma");
		expect(profile.publicVector.gdpr.consentLevel).toBe("medium");
		expect(profile.publicVector.values).toBeNull();
	});

	it("keeps humans at agent-interaction visibility until synergy is confirmed", () => {
		const a = createAgentSurfaceProfile(
			"sirokuma",
			"Nicolas",
			vector(),
			"high",
			"jp",
		);
		const b = createAgentSurfaceProfile(
			"kani",
			"Shierra",
			vector(),
			"high",
			"jp",
		);

		expect(scoreSurfaceCompatibility(a, b)).toBeGreaterThan(0.8);
		const connection = negotiateSurfaceConnection(a, b, {
			threshold: 0.8,
			now: "2026-06-28T00:00:00.000Z",
		});

		expect(connection.status).toBe("synergy_confirmed");
		expect(connection.visibleToHumans).toBe("human-reveal-available");
	});

	it("does not approve human reveal before synergy confirmation", () => {
		const a = createAgentSurfaceProfile(
			"sirokuma",
			"Nicolas",
			vector(),
			"low",
			"jp",
		);
		const b = createAgentSurfaceProfile(
			"kani",
			"Shierra",
			vector(),
			"low",
			"jp",
		);
		const connection = negotiateSurfaceConnection(a, b, {
			threshold: 0.95,
			now: "2026-06-28T00:00:00.000Z",
		});

		const reveal = approveHumanReveal(connection, "2026-06-28T00:01:00.000Z");

		expect(reveal.status).toBe("agent_interaction");
		expect(reveal.auditTrail).toContain("human-reveal-denied-before-synergy");
	});
});

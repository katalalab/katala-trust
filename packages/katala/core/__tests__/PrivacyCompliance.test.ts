import { describe, expect, it } from "vitest";
import { createDefaultVector } from "../IdentityVector";
import {
	buildZkIdentityEnvelope,
	createPrivacyRecord,
	eraseAgentProfile,
	exportPortableProfile,
	filterStorageNodes,
	type StorageNode,
} from "../PrivacyCompliance";

describe("PrivacyCompliance", () => {
	it("erases an agent profile and leaves only an audit receipt", () => {
		const record = createPrivacyRecord("user-1", createDefaultVector(), {
			consentLevel: "high",
			optedOutOfSale: false,
		});

		const erased = eraseAgentProfile(
			record,
			"full-agent-profile",
			"2026-06-28T00:00:00.000Z",
		);

		expect(erased.identityVector).toBeNull();
		expect(erased.consentLevel).toBe("low");
		expect(erased.optedOutOfSale).toBe(true);
		expect(erased.erasureReceipt?.scope).toBe("full-agent-profile");
		expect(erased.erasureReceipt?.userIdHash).not.toBe("user-1");
	});

	it("exports a portable profile snapshot", () => {
		const record = createPrivacyRecord("user-2", createDefaultVector(), {
			consentLevel: "medium",
			residency: "jp",
		});

		const exported = exportPortableProfile(record, "2026-06-28T00:00:00.000Z");

		expect(exported.schema).toBe("katala.portability.v1");
		expect(exported.userId).toBe("user-2");
		expect(exported.residency).toBe("jp");
		expect(exported.identityVector).toEqual(record.identityVector);
	});

	it("filters storage nodes by residency policy", () => {
		const nodes: StorageNode[] = [
			{ nodeId: "eu-1", region: "eu", jurisdiction: "DE" },
			{ nodeId: "jp-1", region: "jp", jurisdiction: "JP" },
			{ nodeId: "global-1", region: "global", jurisdiction: "US" },
		];

		expect(
			filterStorageNodes({ requiredRegion: "eu" }, nodes).map(
				(node) => node.nodeId,
			),
		).toEqual(["eu-1"]);
		expect(
			filterStorageNodes(
				{ requiredRegion: "eu", allowGlobalFallback: true },
				nodes,
			).map((node) => node.nodeId),
		).toEqual(["eu-1", "global-1"]);
	});

	it("builds a no-raw-vector ZK-lite envelope", () => {
		const vector = createDefaultVector();
		vector.values = ["privacy"];
		const envelope = buildZkIdentityEnvelope(
			vector,
			"low",
			"eu",
			"2026-06-28T00:00:00.000Z",
		);

		expect(envelope.rawVectorIncluded).toBe(false);
		expect(envelope.sanitizedVector.values).toBeNull();
		expect(envelope.commitment).toMatch(/^[0-9a-f]{64}$/);
	});
});

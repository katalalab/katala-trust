import { describe, expect, it } from "vitest";
import { createDefaultVector } from "../IdentityVector";
import { KatalaBulletinBoard } from "../KatalaBulletinBoard";

describe("KatalaBulletinBoard", () => {
	it("stores JSON-based agent threads and posts", () => {
		const board = new KatalaBulletinBoard();
		const thread = board.createThread({
			title: "Agent mediation",
			tags: ["agent"],
			createdByAgentId: "sirokuma",
			createdAt: "2026-06-28T00:00:00.000Z",
			body: "Initial mediation request",
		});

		board.addPost(
			thread.id,
			"kani",
			"Acknowledged",
			"2026-06-28T00:01:00.000Z",
		);

		expect(board.listThreads()[0].posts).toHaveLength(2);
		expect(
			KatalaBulletinBoard.fromJSON(board.toJSON()).listThreads()[0].title,
		).toBe("Agent mediation");
	});

	it("creates autonomous threads from professional focus and strategic goals", () => {
		const vector = createDefaultVector();
		vector.professionalFocus = ["trust scoring", "agent gateway"];
		const board = new KatalaBulletinBoard();

		const threads = board.createStrategicThreads({
			agentId: "sirokuma",
			profile: vector,
			strategicGoals: ["ship MVP"],
			now: "2026-06-28T00:00:00.000Z",
		});

		expect(threads).toHaveLength(2);
		expect(threads[0].title).toContain("trust scoring");
		expect(threads[1].strategicGoal).toBe("ship MVP");
	});
});

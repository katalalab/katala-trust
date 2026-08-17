import { describe, expect, it } from "vitest";
import { sanitizeThinkRequest } from "./contextSanitizer.mjs";

describe("contextSanitizer", () => {
	it("drops PRIVATE and IGNORE while keeping PUBLIC/MEDIATION", () => {
		const { request, dropped_private, dropped_ignore } = sanitizeThinkRequest({
			request_id: "r1",
			memory_mode: "ephemeral",
			context_items: [
				{ id: "1", visibility: "PUBLIC", content: "ok" },
				{ id: "2", visibility: "PRIVATE", content: "secret" },
				{ id: "3", visibility: "IGNORE", content: "noise" },
				{ id: "4", visibility: "MEDIATION", content: "shared" },
			],
		});
		expect(dropped_private).toBe(1);
		expect(dropped_ignore).toBe(1);
		expect(request.memory_mode).toBe("none");
		const items = request.context_items as Array<{ id: string }>;
		expect(items).toHaveLength(2);
		expect(items.map((i) => i.id)).toEqual(["1", "4"]);
	});
});

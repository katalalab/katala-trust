import { describe, expect, it } from "vitest";
import { decideHostAction } from "./hostApprovalGate.mjs";

describe("hostApprovalGate", () => {
	it("allows clean ok responses", () => {
		expect(
			decideHostAction({
				status: "ok",
				safety: { requires_human_approval: false },
				verification: { grade: "A" },
			}),
		).toMatchObject({ decision: "allow" });
	});

	it("asks human when needs-human or approval flag is set", () => {
		expect(
			decideHostAction({ status: "needs-human", verification: { grade: "C" } }),
		).toMatchObject({
			decision: "ask-human",
		});
		expect(
			decideHostAction({
				status: "ok",
				safety: { requires_human_approval: true },
				verification: { grade: "B" },
			}),
		).toMatchObject({ decision: "ask-human" });
	});

	it("blocks unsafe/rejected and D/F grades", () => {
		expect(decideHostAction({ status: "unsafe" })).toMatchObject({
			decision: "block",
		});
		expect(decideHostAction({ status: "rejected" })).toMatchObject({
			decision: "block",
		});
		expect(
			decideHostAction({ status: "ok", verification: { grade: "F" } }),
		).toMatchObject({
			decision: "block",
		});
	});

	it("fails closed to ask-human on garbage input", () => {
		expect(decideHostAction(null)).toMatchObject({ decision: "ask-human" });
		expect(decideHostAction({})).toMatchObject({ decision: "ask-human" });
	});
});

import { describe, expect, it } from "vitest";
import { OPENCLAW_KATALA_THINK_TOOL, toolArgsToThinkRequest } from "./openClawToolAdapter.mjs";

describe("openClawToolAdapter", () => {
  it("maps free-text context into a PUBLIC context item", () => {
    const req = toolArgsToThinkRequest(
      { goal: "Review plan", mode: "review", context: "Docs say read-only." },
      { hostName: "host", sessionId: "s1", requestId: "r1" },
    );
    expect(req.request_id).toBe("r1");
    expect(req.task.mode).toBe("review");
    expect(req.memory_mode).toBe("none");
    expect(req.context_items).toHaveLength(1);
    expect(req.context_items[0].content).toContain("read-only");
    expect(req.capabilities.can_write).toBe(false);
  });

  it("falls back unknown mode to review and keeps capabilities false by default", () => {
    const req = toolArgsToThinkRequest({ goal: "x", mode: "explode" });
    expect(req.task.mode).toBe("review");
    expect(req.capabilities).toEqual({
      can_write: false,
      can_shell: false,
      can_network: false,
    });
  });

  it("exposes a stable tool descriptor", () => {
    expect(OPENCLAW_KATALA_THINK_TOOL.name).toBe("katala_think");
    expect(OPENCLAW_KATALA_THINK_TOOL.parameters.required).toContain("goal");
  });
});

describe("normalizeVisibility fallback direction", () => {
  const ctx = { hostName: "host", sessionId: "s1", requestId: "r1" };

  // An unrecognised token used to become PUBLIC, so "secret" and "confidential" were
  // scored and forwarded as public context. Guessing must not widen exposure.
  it("treats an unknown visibility as PRIVATE", () => {
    const req = toolArgsToThinkRequest(
      { goal: "g", context_items: [{ id: "a", content: "x", visibility: "secret" }] },
      ctx,
    );
    expect(req.context_items[0].visibility).toBe("PRIVATE");
  });

  it("keeps the documented PUBLIC default when visibility is absent", () => {
    const req = toolArgsToThinkRequest(
      { goal: "g", context_items: [{ id: "a", content: "x" }] },
      ctx,
    );
    expect(req.context_items[0].visibility).toBe("PUBLIC");
  });
});

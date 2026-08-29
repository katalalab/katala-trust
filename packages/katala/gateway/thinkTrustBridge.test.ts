import { describe, expect, it } from "vitest";
import { evaluateContextTrust } from "./thinkTrustBridge.mjs";
import { decideHostAction } from "./hostApprovalGate.mjs";

const item = (visibility: string, content: string) => ({
  id: `c-${visibility}-${content.length}`,
  kind: "note",
  content,
  visibility,
  provenance: "test",
  ttl_seconds: 3600,
});

describe("evaluateContextTrust with nothing to score", () => {
  // The sidecar scores PUBLIC and MEDIATION items. A request carrying neither gives it
  // no evidence at all — which is the one case where saying "fine" is a claim it cannot
  // support. This package's README promises fail-closed, so the absence of evidence has
  // to reach a human rather than pass.
  it("asks for a human instead of passing", () => {
    const result = evaluateContextTrust([item("PRIVATE", "internal only")]);

    expect(result.grade).toBe("N/A");
    expect(result.composite_score).toBeNull();
    expect(result.caveats).toContain("no_public_or_mediation_context_to_score");
    expect(result.requires_human_approval).toBe(true);
  });

  it("does not reach allow through the host gate", () => {
    // grade "N/A" is neither D nor F, so the gate's block check never sees it. Only the
    // approval flag stands between an unscored request and "allow"; this pins that the
    // two halves agree.
    const trust = evaluateContextTrust([item("PRIVATE", "internal only")]);

    expect(
      decideHostAction({
        status: "ok",
        safety: { requires_human_approval: trust.requires_human_approval },
        verification: { grade: trust.grade },
      }),
    ).toMatchObject({ decision: "ask-human" });
  });

  it("still scores when public context is present", () => {
    // The guard must not swallow the normal path: with something to score, the sidecar
    // produces a grade rather than deferring everything to a human.
    const result = evaluateContextTrust([
      item("PUBLIC", "a published statement with enough body to score"),
    ]);

    expect(result.grade).not.toBe("N/A");
    expect(result.claim_count).toBeGreaterThan(0);
  });
});

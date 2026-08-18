/**
 * Local trust + consensus bridge for katala:think.
 * Mirrors packages/katala/core/TrustScorer scoring formulas for zero-build ESM CLI use.
 * Dual weight profiles act as local "agents" so ConsensusEngine-style aggregate works offline.
 */

const DOMAIN_HALF_LIFE = {
	news: 24,
	finance: 48,
	tech: 168,
	science: 720,
	general: 336,
};

function toGrade(score) {
	if (score >= 0.9) return "S";
	if (score >= 0.8) return "A";
	if (score >= 0.65) return "B";
	if (score >= 0.5) return "C";
	if (score >= 0.35) return "D";
	return "F";
}

function inferSourceType(provenance, kind) {
	const blob = `${provenance} ${kind}`.toLowerCase();
	if (/(generated|llm|ai-output|model-output)/.test(blob)) return "generated";
	if (/(rumor|hearsay|unverified|tertiary)/.test(blob)) return "tertiary";
	if (/(primary|official|paper|rfc|spec|first-party)/.test(blob))
		return "primary";
	if (/(secondary|news|press|summary|quote)/.test(blob)) return "secondary";
	return "secondary";
}

function scoreFreshness(claim, nowMs) {
	const published = claim.source.publishedAt
		? new Date(claim.source.publishedAt).getTime()
		: new Date(claim.retrievedAt).getTime();
	const ageHours = Math.max(0, (nowMs - published) / (1000 * 60 * 60));
	const halfLife =
		DOMAIN_HALF_LIFE[claim.domain ?? "general"] ?? DOMAIN_HALF_LIFE.general;
	return Math.exp(-ageHours / halfLife);
}

function scoreProvenance(claim) {
	let score = 0.6;
	switch (claim.source.type) {
		case "primary":
			score = 0.9;
			break;
		case "secondary":
			score = 0.6;
			break;
		case "tertiary":
			score = 0.3;
			break;
		case "generated":
			score = 0.2;
			break;
	}
	if (claim.source.author) score = Math.min(1, score + 0.05);
	if (claim.source.url) score = Math.min(1, score + 0.05);
	return score;
}

function scoreVerification(corroboratingCount, contradictingCount) {
	let score = 0.3;
	for (let i = 0; i < corroboratingCount; i += 1) {
		score = Math.min(1, score + 0.15 / (i + 1));
	}
	for (let i = 0; i < contradictingCount; i += 1) {
		score = Math.max(0, score - 0.2 / (i + 1));
	}
	return score;
}

function scoreAccessibility(claim) {
	let score = 0.5;
	if (claim.source.url) score += 0.3;
	if (claim.source.publishedAt) score += 0.1;
	if (claim.source.type === "primary") score += 0.1;
	return Math.min(1, score);
}

function scoreClaim(
	claim,
	weights,
	corroboratingCount,
	contradictingCount,
	nowMs,
) {
	const axes = {
		freshness: scoreFreshness(claim, nowMs),
		provenance: scoreProvenance(claim),
		verification: scoreVerification(corroboratingCount, contradictingCount),
		accessibility: scoreAccessibility(claim),
	};
	const compositeScore =
		axes.freshness * weights.freshness +
		axes.provenance * weights.provenance +
		axes.verification * weights.verification +
		axes.accessibility * weights.accessibility;
	return {
		claimId: claim.id,
		axes,
		compositeScore,
		grade: toGrade(compositeScore),
		reasoning: `source=${claim.source.type}; provenance=${claim.source.author ?? "unknown"}`,
	};
}

const PROVENANCE_HEAVY = {
	freshness: 0.1,
	provenance: 0.45,
	verification: 0.35,
	accessibility: 0.1,
};

const FRESHNESS_HEAVY = {
	freshness: 0.4,
	provenance: 0.2,
	verification: 0.3,
	accessibility: 0.1,
};

function contextToClaim(item, nowIso) {
	return {
		id: item.id,
		content: item.content,
		source: {
			type: inferSourceType(item.provenance, item.kind),
			author: item.provenance.slice(0, 120),
			platform: item.kind,
		},
		domain: "general",
		retrievedAt: nowIso,
		language: "ja",
	};
}

function aggregateVerdicts(verdicts) {
	let totalWeight = 0;
	let weightedScore = 0;
	const weightedAxes = {
		freshness: 0,
		provenance: 0,
		verification: 0,
		accessibility: 0,
	};

	for (const verdict of verdicts) {
		const weight = verdict.confidence;
		totalWeight += weight;
		weightedScore += verdict.result.compositeScore * weight;
		weightedAxes.freshness += verdict.result.axes.freshness * weight;
		weightedAxes.provenance += verdict.result.axes.provenance * weight;
		weightedAxes.verification += verdict.result.axes.verification * weight;
		weightedAxes.accessibility += verdict.result.axes.accessibility * weight;
	}

	if (totalWeight === 0) {
		return {
			finalScore: 0,
			finalAxes: {
				freshness: 0,
				provenance: 0,
				verification: 0,
				accessibility: 0,
			},
		};
	}

	return {
		finalScore: weightedScore / totalWeight,
		finalAxes: {
			freshness: weightedAxes.freshness / totalWeight,
			provenance: weightedAxes.provenance / totalWeight,
			verification: weightedAxes.verification / totalWeight,
			accessibility: weightedAxes.accessibility / totalWeight,
		},
	};
}

function round4(value) {
	return Math.round(value * 10_000) / 10_000;
}

/**
 * @param {Array<{id:string,kind:string,content:string,visibility:string,provenance:string,ttl_seconds:number}>} contextItems
 */
export function evaluateContextTrust(contextItems, now = new Date()) {
	const nowIso = now.toISOString();
	const nowMs = now.getTime();
	const scorable = contextItems.filter(
		(item) => item.visibility === "PUBLIC" || item.visibility === "MEDIATION",
	);

	if (scorable.length === 0) {
		return {
			enabled: true,
			claim_count: 0,
			composite_score: null,
			grade: "N/A",
			consensus: "none",
			divergence: 0,
			axes: null,
			caveats: ["no_public_or_mediation_context_to_score"],
			dissent: [],
			claim_summaries: [],
      // Nothing to score is not the same as nothing wrong. Returning false here let a
      // request with no PUBLIC or MEDIATION context through as status=ok, and
      // hostApprovalGate answers "allow" for that — grade "N/A" is neither D nor F, so
      // the block check does not catch it either. The sidecar's whole job was skipped
      // silently on the path where it had no evidence at all, in a package whose README
      // promises fail-closed recommendations.
      requires_human_approval: true,
		};
	}

	const claims = scorable.map((item) => contextToClaim(item, nowIso));
	const claimResults = [];

	for (const claim of claims) {
		const siblings = claims.filter((other) => other.id !== claim.id);
		const corroboratingCount = siblings.filter(
			(other) => other.source.author !== claim.source.author,
		).length;

		const provenanceAgent = scoreClaim(
			claim,
			PROVENANCE_HEAVY,
			corroboratingCount,
			0,
			nowMs,
		);
		const freshnessAgent = scoreClaim(
			claim,
			FRESHNESS_HEAVY,
			corroboratingCount,
			0,
			nowMs,
		);

		const verdicts = [
			{
				agentId: "local-provenance-heavy",
				confidence: 0.7,
				result: provenanceAgent,
			},
			{
				agentId: "local-freshness-heavy",
				confidence: 0.7,
				result: freshnessAgent,
			},
		];

		const divergence = Math.abs(
			provenanceAgent.compositeScore - freshnessAgent.compositeScore,
		);
		const { finalScore, finalAxes } = aggregateVerdicts(verdicts);
		let consensus = "majority";
		if (divergence <= 0.05) consensus = "unanimous";
		else if (divergence > 0.15) consensus = "deadlock";

		const dissent =
			divergence > 0.1
				? verdicts
						.filter(
							(verdict) =>
								Math.abs(verdict.result.compositeScore - finalScore) > 0.08,
						)
						.map((verdict) => ({
							agent_id: verdict.agentId,
							score: round4(verdict.result.compositeScore),
							reasoning: verdict.result.reasoning.slice(0, 200),
						}))
				: [];

		claimResults.push({
			id: claim.id,
			composite_score: round4(finalScore),
			grade: toGrade(finalScore),
			axes: {
				freshness: round4(finalAxes.freshness),
				provenance: round4(finalAxes.provenance),
				verification: round4(finalAxes.verification),
				accessibility: round4(finalAxes.accessibility),
			},
			consensus,
			divergence: round4(divergence),
			dissent,
			caveats:
				claim.source.type === "generated"
					? ["generated_source_has_low_baseline_trust"]
					: [],
		});
	}

	const avgScore =
		claimResults.reduce((sum, item) => sum + item.composite_score, 0) /
		claimResults.length;
	const maxDivergence = Math.max(
		...claimResults.map((item) => item.divergence),
	);
	const worstGradeOrder = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };
	const worstGrade = claimResults.reduce(
		(worst, item) =>
			worstGradeOrder[item.grade] > worstGradeOrder[worst] ? item.grade : worst,
		"S",
	);
	const consensus =
		maxDivergence <= 0.05
			? "unanimous"
			: maxDivergence > 0.15
				? "deadlock"
				: "majority";

	const axes = {
		freshness: round4(
			claimResults.reduce((sum, item) => sum + item.axes.freshness, 0) /
				claimResults.length,
		),
		provenance: round4(
			claimResults.reduce((sum, item) => sum + item.axes.provenance, 0) /
				claimResults.length,
		),
		verification: round4(
			claimResults.reduce((sum, item) => sum + item.axes.verification, 0) /
				claimResults.length,
		),
		accessibility: round4(
			claimResults.reduce((sum, item) => sum + item.axes.accessibility, 0) /
				claimResults.length,
		),
	};

	const caveats = [
		...new Set(claimResults.flatMap((item) => item.caveats)),
		"local_dual_profile_consensus_not_multi_llm",
	];
	const dissent = claimResults.flatMap((item) => item.dissent).slice(0, 4);
	const requiresHuman =
		avgScore < 0.5 ||
		worstGrade === "D" ||
		worstGrade === "F" ||
		consensus === "deadlock";

	return {
		enabled: true,
		claim_count: claimResults.length,
		composite_score: round4(avgScore),
		grade: toGrade(avgScore),
		consensus,
		divergence: round4(maxDivergence),
		axes,
		caveats: caveats.slice(0, 8),
		dissent,
		claim_summaries: claimResults.map((item) => ({
			id: item.id,
			grade: item.grade,
			composite_score: item.composite_score,
		})),
		requires_human_approval: requiresHuman,
	};
}

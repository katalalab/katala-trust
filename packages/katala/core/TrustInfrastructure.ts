import { TrustResult } from "./TrustScorer";

export type DisclosureStatus = "clear" | "disclosed" | "conflicted";
export type AuditCadence = "none" | "annual" | "quarterly" | "continuous";

export interface TrustInfrastructurePlan {
	algorithmOpenSource: boolean;
	algorithmRoadmap: string[];
	conflictDisclosure: DisclosureStatus;
	falsifiableScoreView: boolean;
	parallelCriteria: string[];
	immutableLog: boolean;
	thirdPartyAudit: AuditCadence;
	distributedEvaluation: boolean;
	criteriaVersioning: boolean;
	criteriaDiffView: boolean;
}

export interface TrustInfrastructureAssessment {
	score: number;
	passed: boolean;
	gaps: string[];
	capabilities: string[];
}

export interface ScoreEvidenceView {
	claimId: string;
	compositeScore: number;
	grade: TrustResult["grade"];
	standardId: string;
	standardVersion: string;
	evidenceRefs: string[];
	contradictingRefs: string[];
	revisionCount: number;
	falsifiable: boolean;
}

const REQUIRED_CAPABILITIES: Array<[keyof TrustInfrastructurePlan, string]> = [
	["algorithmOpenSource", "open-source scoring algorithm"],
	["falsifiableScoreView", "falsifiable score UI"],
	["immutableLog", "immutable evaluation history"],
	["distributedEvaluation", "distributed evaluator architecture"],
	["criteriaVersioning", "criteria versioning"],
	["criteriaDiffView", "criteria diff display"],
];

export function assessTrustInfrastructure(
	plan: TrustInfrastructurePlan,
): TrustInfrastructureAssessment {
	const gaps: string[] = [];
	const capabilities: string[] = [];

	for (const [field, label] of REQUIRED_CAPABILITIES) {
		if (plan[field]) capabilities.push(label);
		else gaps.push(`missing ${label}`);
	}
	if (plan.algorithmRoadmap.length === 0)
		gaps.push("missing open-source roadmap milestones");
	else capabilities.push("open-source roadmap");
	if (plan.conflictDisclosure === "conflicted")
		gaps.push("unresolved evaluator conflict");
	else capabilities.push("conflict disclosure framework");
	if (plan.parallelCriteria.length < 2)
		gaps.push("parallel criteria requires at least two standards");
	else capabilities.push("parallel criteria display");
	if (plan.thirdPartyAudit === "none")
		gaps.push("missing third-party audit program");
	else capabilities.push(`${plan.thirdPartyAudit} third-party audit`);

	const total = REQUIRED_CAPABILITIES.length + 4;
	const score = Number(((total - gaps.length) / total).toFixed(4));
	return {
		score,
		passed: gaps.length === 0,
		gaps,
		capabilities,
	};
}

export function buildScoreEvidenceView(
	result: TrustResult,
	options: {
		standardId: string;
		standardVersion: string;
		evidenceRefs?: string[];
		revisionHashes?: string[];
	},
): ScoreEvidenceView {
	const evidenceRefs = options.evidenceRefs ?? [];
	const revisionHashes = options.revisionHashes ?? [];
	return {
		claimId: result.claimId,
		compositeScore: result.compositeScore,
		grade: result.grade,
		standardId: options.standardId,
		standardVersion: options.standardVersion,
		evidenceRefs,
		contradictingRefs: result.contradictingClaims,
		revisionCount: revisionHashes.length,
		falsifiable: evidenceRefs.length > 0 && revisionHashes.length > 0,
	};
}

export function diffCriteriaVersions(
	previous: Record<string, number>,
	next: Record<string, number>,
): Array<{
	criterion: string;
	before: number | null;
	after: number | null;
	delta: number | null;
}> {
	const keys = Object.keys({ ...previous, ...next }).sort();
	return keys.map((criterion) => {
		const before = previous[criterion] ?? null;
		const after = next[criterion] ?? null;
		return {
			criterion,
			before,
			after,
			delta:
				before === null || after === null
					? null
					: Number((after - before).toFixed(4)),
		};
	});
}

import type { ConsentLevel, SanitizedIdentityVector } from "./GdprSanitizer";
import { sanitizeForMediation } from "./GdprSanitizer";
import type { IdentityVector } from "./IdentityVector";
import type { ResidencyRegion } from "./PrivacyCompliance";

export type SurfaceConnectionStatus =
	| "agent_interaction"
	| "synergy_confirmed"
	| "human_reveal_allowed"
	| "rejected";

export interface AgentSurfaceProfile {
	agentId: string;
	humanAlias: string;
	consentLevel: ConsentLevel;
	residency: ResidencyRegion;
	publicVector: SanitizedIdentityVector;
}

export interface SurfaceConnection {
	connectionId: string;
	initiatorAgentId: string;
	responderAgentId: string;
	status: SurfaceConnectionStatus;
	visibleToHumans:
		| "agent-interaction-only"
		| "human-reveal-available"
		| "hidden";
	synergyScore: number;
	threshold: number;
	createdAt: string;
	updatedAt: string;
	auditTrail: string[];
}

export interface SurfaceConnectionOptions {
	threshold?: number;
	now?: string;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function overlapScore(a: string[] | null, b: string[] | null): number {
	if (!a?.length || !b?.length) return 0;
	const setA = new Set(a.map((item) => item.toLowerCase()));
	const intersection = b.filter((item) => setA.has(item.toLowerCase()));
	const union = new Set([...a, ...b].map((item) => item.toLowerCase()));
	return intersection.length / union.size;
}

function personalityScore(
	a: SanitizedIdentityVector,
	b: SanitizedIdentityVector,
): number {
	const scores: number[] = [];
	for (const key of Object.keys(
		a.personality,
	) as (keyof SanitizedIdentityVector["personality"])[]) {
		const left = a.personality[key];
		const right = b.personality[key];
		if (left !== null && right !== null) {
			scores.push(1 - Math.abs(left - right));
		}
	}
	if (scores.length === 0) return 0;
	return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function socialScore(
	a: SanitizedIdentityVector,
	b: SanitizedIdentityVector,
): number {
	const battery =
		1 - Math.abs(a.socialEnergy.battery - b.socialEnergy.battery) / 100;
	const tone =
		a.socialEnergy.preferredTone === b.socialEnergy.preferredTone ? 1 : 0.5;
	return battery * 0.6 + tone * 0.4;
}

export function createAgentSurfaceProfile(
	agentId: string,
	humanAlias: string,
	vector: IdentityVector,
	consentLevel: ConsentLevel,
	residency: ResidencyRegion = "global",
): AgentSurfaceProfile {
	return {
		agentId,
		humanAlias,
		consentLevel,
		residency,
		publicVector: sanitizeForMediation(vector, consentLevel),
	};
}

export function scoreSurfaceCompatibility(
	initiator: AgentSurfaceProfile,
	responder: AgentSurfaceProfile,
): number {
	const left = initiator.publicVector;
	const right = responder.publicVector;
	const confidence =
		(left.meta.confidenceScore + right.meta.confidenceScore) / 2;
	const score =
		personalityScore(left, right) * 0.35 +
		overlapScore(left.values, right.values) * 0.25 +
		overlapScore(left.professionalFocus, right.professionalFocus) * 0.25 +
		socialScore(left, right) * 0.15;
	return clamp01(score * Math.max(confidence, 0.25));
}

export function negotiateSurfaceConnection(
	initiator: AgentSurfaceProfile,
	responder: AgentSurfaceProfile,
	options: SurfaceConnectionOptions = {},
): SurfaceConnection {
	const now = options.now ?? new Date().toISOString();
	const threshold = options.threshold ?? 0.6;
	const synergyScore = scoreSurfaceCompatibility(initiator, responder);
	const confirmed = synergyScore >= threshold;

	return {
		connectionId: `surface_${initiator.agentId}_${responder.agentId}_${now}`,
		initiatorAgentId: initiator.agentId,
		responderAgentId: responder.agentId,
		status: confirmed ? "synergy_confirmed" : "agent_interaction",
		visibleToHumans: confirmed
			? "human-reveal-available"
			: "agent-interaction-only",
		synergyScore,
		threshold,
		createdAt: now,
		updatedAt: now,
		auditTrail: [
			"public-profile-exchange",
			confirmed ? "synergy-threshold-met" : "agent-interaction-held",
		],
	};
}

export function approveHumanReveal(
	connection: SurfaceConnection,
	approvedAt: string = new Date().toISOString(),
): SurfaceConnection {
	if (connection.status !== "synergy_confirmed") {
		return {
			...connection,
			updatedAt: approvedAt,
			auditTrail: [
				...connection.auditTrail,
				"human-reveal-denied-before-synergy",
			],
		};
	}
	return {
		...connection,
		status: "human_reveal_allowed",
		visibleToHumans: "human-reveal-available",
		updatedAt: approvedAt,
		auditTrail: [...connection.auditTrail, "human-reveal-approved"],
	};
}

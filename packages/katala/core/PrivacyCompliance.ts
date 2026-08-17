import { createHash } from "crypto";
import { createDefaultVector, type IdentityVector } from "./IdentityVector";
import {
	sanitizeForMediation,
	type ConsentLevel,
	type SanitizedIdentityVector,
} from "./GdprSanitizer";

export type ResidencyRegion = "global" | "eu" | "us-ca" | "jp" | "kr";

export interface StorageNode {
	nodeId: string;
	region: ResidencyRegion;
	jurisdiction: string;
	labels?: string[];
}

export interface ResidencyPolicy {
	requiredRegion: ResidencyRegion;
	allowGlobalFallback?: boolean;
}

export interface AgentPrivacyRecord {
	userId: string;
	identityVector: IdentityVector | null;
	consentLevel: ConsentLevel;
	residency: ResidencyRegion;
	optedOutOfSale: boolean;
	deletedAt?: string;
	erasureReceipt?: ErasureReceipt;
}

export interface ErasureReceipt {
	receiptId: string;
	userIdHash: string;
	erasedAt: string;
	scope: "identity-vector" | "full-agent-profile";
	retainedFields: string[];
}

export interface PortabilityExport {
	schema: "katala.portability.v1";
	exportedAt: string;
	userId: string;
	residency: ResidencyRegion;
	consentLevel: ConsentLevel;
	optedOutOfSale: boolean;
	identityVector: IdentityVector | null;
}

export interface ZkIdentityEnvelope {
	schema: "katala.zk_identity_envelope.v1";
	createdAt: string;
	residency: ResidencyRegion;
	consentLevel: ConsentLevel;
	rawVectorIncluded: false;
	sanitizedVector: SanitizedIdentityVector;
	commitment: string;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalize).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function createPrivacyRecord(
	userId: string,
	identityVector: IdentityVector = createDefaultVector(),
	options: Partial<
		Pick<AgentPrivacyRecord, "consentLevel" | "residency" | "optedOutOfSale">
	> = {},
): AgentPrivacyRecord {
	return {
		userId,
		identityVector,
		consentLevel: options.consentLevel ?? "low",
		residency: options.residency ?? "global",
		optedOutOfSale: options.optedOutOfSale ?? true,
	};
}

export function eraseAgentProfile(
	record: AgentPrivacyRecord,
	scope: ErasureReceipt["scope"] = "identity-vector",
	erasedAt: string = new Date().toISOString(),
): AgentPrivacyRecord {
	const retainedFields = ["userIdHash", "erasedAt", "scope", "receiptId"];
	const receipt: ErasureReceipt = {
		receiptId: `erase_${sha256(`${record.userId}:${erasedAt}:${scope}`).slice(0, 16)}`,
		userIdHash: sha256(record.userId),
		erasedAt,
		scope,
		retainedFields,
	};

	return {
		...record,
		identityVector: null,
		consentLevel: "low",
		optedOutOfSale: true,
		deletedAt: erasedAt,
		erasureReceipt: receipt,
	};
}

export function exportPortableProfile(
	record: AgentPrivacyRecord,
	exportedAt: string = new Date().toISOString(),
): PortabilityExport {
	return {
		schema: "katala.portability.v1",
		exportedAt,
		userId: record.userId,
		residency: record.residency,
		consentLevel: record.consentLevel,
		optedOutOfSale: record.optedOutOfSale,
		identityVector: record.identityVector,
	};
}

export function isStorageNodeAllowed(
	policy: ResidencyPolicy,
	node: StorageNode,
): boolean {
	if (policy.requiredRegion === "global") return true;
	if (node.region === policy.requiredRegion) return true;
	return policy.allowGlobalFallback === true && node.region === "global";
}

export function filterStorageNodes(
	policy: ResidencyPolicy,
	nodes: StorageNode[],
): StorageNode[] {
	return nodes.filter((node) => isStorageNodeAllowed(policy, node));
}

export function buildZkIdentityEnvelope(
	vector: IdentityVector,
	consentLevel: ConsentLevel,
	residency: ResidencyRegion,
	createdAt: string = new Date().toISOString(),
): ZkIdentityEnvelope {
	const sanitizedVector = sanitizeForMediation(vector, consentLevel);
	return {
		schema: "katala.zk_identity_envelope.v1",
		createdAt,
		residency,
		consentLevel,
		rawVectorIncluded: false,
		sanitizedVector,
		commitment: sha256(
			canonicalize({ sanitizedVector, residency, consentLevel }),
		),
	};
}

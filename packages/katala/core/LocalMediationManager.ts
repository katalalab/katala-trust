import { isTrustedTailnetAddress } from "./AgentGatewayPolicy";
import { MediationService } from "./MediationService";
import { SynergyEngine } from "./SynergyEngine";
import type { SynergyRequest, SynergyResponse } from "./types";

/**
 * LocalMediationManager
 * Manages the local lifecycle and mediation between local agents.
 * Integrates with the Gateway for Katala-Claw bridge.
 */
export class LocalMediationManager {
	private service: MediationService;
	private engine: SynergyEngine;

	constructor() {
		this.service = new MediationService();
		this.engine = new SynergyEngine();
	}

	/**
	 * Resolves a synergy request locally.
	 */
	public async mediate(request: SynergyRequest): Promise<SynergyResponse> {
		const userA = request.user_a?.user_id || "unknown";
		const userB = request.user_b?.user_id || "unknown";

		console.log(`[Mediation] Calculating synergy for ${userA} <-> ${userB}`);

		try {
			const result = await this.service.calculateSynergy(request);
			console.log(
				`[Mediation] Result computed: ${(result.synergy?.score || 0).toFixed(2)} synergy`,
			);
			return result;
		} catch (error) {
			console.error(`[Mediation] Failed to calculate synergy:`, error);
			throw error;
		}
	}

	/**
	 * Performs local identity verification for handshake using Tailscale metadata.
	 * Range check only; production should also confirm node membership via Tailscale API.
	 */
	public async verifyIdentity(tailscaleIp: string): Promise<boolean> {
		console.log(`[Security] Verifying Tailscale identity: ${tailscaleIp}`);
		return isTrustedTailnetAddress(tailscaleIp);
	}
}

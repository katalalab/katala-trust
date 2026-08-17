import * as http from "http";
import {
	parseGatewayTokens,
	validateMediationEnvelope,
	verifyPeerRequest,
} from "../core/AgentGatewayPolicy";
import { LocalMediationManager } from "../core/LocalMediationManager";
import { IntakeEnvelope, IntakeRouter } from "./IntakeRouter";
import { PythonInfCodingAdapter } from "./PythonInfCodingAdapter";

export interface KatalaClawGatewayOptions {
	port?: number;
	trustedTailscalePrefixes?: string[];
	peerTokens?: string[];
	requireToken?: boolean;
	intakeMode?: "short-circuit" | "full-pipeline";
}

/**
 * KatalaClawGateway
 * The "Katala-Claw" bridge for cross-agent communication.
 * Ensures secure handshakes and integrates local mediation.
 */
export class KatalaClawGateway {
	private manager: LocalMediationManager;
	private intakeRouter: IntakeRouter;
	private pythonAdapter: PythonInfCodingAdapter;
	private server: http.Server | null = null;
	private port: number;
	private trustedTailscalePrefixes?: string[];
	private peerTokens?: string[];
	private requireToken?: boolean;

	constructor(portOrOptions: number | KatalaClawGatewayOptions = 18789) {
		const options: KatalaClawGatewayOptions =
			typeof portOrOptions === "number"
				? { port: portOrOptions }
				: portOrOptions;

		this.port = options.port ?? 18789;
		this.trustedTailscalePrefixes = options.trustedTailscalePrefixes;
		this.peerTokens = options.peerTokens;
		this.requireToken = options.requireToken;
		this.manager = new LocalMediationManager();
		this.intakeRouter = new IntakeRouter(options.intakeMode ?? "short-circuit");
		this.pythonAdapter = new PythonInfCodingAdapter();
	}

	public getPort(): number {
		const address = this.server?.address();
		if (address && typeof address === "object") {
			return address.port;
		}
		return this.port;
	}

	/**
	 * Starts the gateway server.
	 */
	public start(): void {
		void this.startAsync();
	}

	public startAsync(): Promise<number> {
		if (this.server) {
			return Promise.resolve(this.getPort());
		}

		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				void this.handleConnection(req, res);
			});

			this.server.once("error", reject);
			this.server.listen(this.port, () => {
				const bound = this.getPort();
				console.log(`[Gateway] Katala-Claw Bridge active on port ${bound}`);
				resolve(bound);
			});
		});
	}

	private resolvePeerAuth(clientIp: string, headers: http.IncomingHttpHeaders) {
		const acceptedTokens =
			this.peerTokens ??
			parseGatewayTokens(
				process.env.KATALA_GATEWAY_PEER_TOKENS ??
					process.env.KATALA_GATEWAY_PEER_TOKEN,
			);
		// Fail-closed: require a peer token unless explicitly disabled.
		const requireToken =
			this.requireToken ??
			(process.env.KATALA_GATEWAY_ALLOW_TAILNET_ONLY === "1"
				? acceptedTokens.length > 0
				: true);

		return verifyPeerRequest(
			{ remoteAddress: clientIp, headers },
			{
				acceptedTokens,
				requireToken,
				trustedTailscalePrefixes: this.trustedTailscalePrefixes,
			},
		);
	}

	private async handleConnection(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const clientIp = req.socket.remoteAddress || "unknown";
		const auth = this.resolvePeerAuth(clientIp, req.headers);

		if (!auth.ok) {
			console.warn(
				`[Gateway] Unauthorized connection attempt from ${clientIp}`,
			);
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: "Forbidden: Untrusted Tailscale identity",
					reason: auth.reason,
					detail:
						"Access is limited to verified Tailscale nodes within the private network.",
				}),
			);
			return;
		}

		if (req.method === "POST" && req.url === "/synergy/mediate") {
			await this.handleMediation(req, res);
			return;
		}
		if (req.method === "POST" && req.url === "/intake/discord") {
			await this.handleDiscordIntake(req, res);
			return;
		}
		if (req.method === "GET" && req.url === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "active",
					bridge: "Katala-Claw",
					identity: "verified",
				}),
			);
			return;
		}

		res.writeHead(404);
		res.end();
	}

	private readBody(
		req: http.IncomingMessage,
		maxBytes = 1_048_576,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			let total = 0;
			req.on("data", (chunk: Buffer) => {
				total += chunk.length;
				if (total > maxBytes) {
					reject(new Error(`request body exceeds ${maxBytes} bytes`));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	/**
	 * Handles the synergy mediation request via the bridge.
	 */
	private async handleMediation(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		try {
			const body = await this.readBody(req);
			const synergyReq = validateMediationEnvelope(JSON.parse(body));
			const result = await this.manager.mediate(synergyReq);

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (error) {
			console.error(`[Gateway] Mediation Error:`, error);
			const status =
				error instanceof SyntaxError
					? 400
					: error instanceof Error && /exceeds .* bytes/.test(error.message)
						? 413
						: 422;
			res.writeHead(status, {
				"Content-Type": "application/json",
			});
			res.end(
				JSON.stringify({
					error: "Invalid Mediation Request",
					message: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		}
	}

	private async handleDiscordIntake(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		try {
			const body = await this.readBody(req);
			const envelope = JSON.parse(body) as IntakeEnvelope;
			const routed = this.intakeRouter.routeDiscordMessage(envelope);

			if (!routed.ok) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify(routed));
				return;
			}

			const handoff = await this.pythonAdapter.handoffDiscordEnvelope(
				routed.envelope,
				routed,
			);
			const responsePayload = {
				...routed,
				handoff: handoff.payload,
				reply:
					(handoff.payload as Record<string, unknown>).reply ?? routed.reply,
			};

			res.writeHead(handoff.ok ? 200 : handoff.status, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(responsePayload));
		} catch (error) {
			console.error(`[Gateway] Discord Intake Error:`, error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: "Internal Intake Error",
					message: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		}
	}

	/**
	 * Stops the gateway server.
	 */
	public stop(): void {
		void this.stopAsync();
	}

	public stopAsync(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close(() => {
				this.server = null;
				console.log(`[Gateway] Katala-Claw Bridge shut down gracefully`);
				resolve();
			});
		});
	}
}

export class PythonInfCodingAdapter {
	async handoffDiscordEnvelope(
		_envelope: unknown,
		routed: { reply?: unknown },
	): Promise<{
		ok: boolean;
		status: number;
		payload: Record<string, unknown>;
	}> {
		return {
			ok: false,
			status: 501,
			payload: {
				error: "python-inf-coding-adapter-not-shipped-in-oss-cut",
				reply: routed.reply ?? null,
			},
		};
	}
}

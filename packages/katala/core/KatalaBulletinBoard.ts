import type { IdentityVector } from "./IdentityVector";

export interface KbbPost {
	id: string;
	authorAgentId: string;
	body: string;
	createdAt: string;
}

export interface KbbThread {
	id: string;
	title: string;
	tags: string[];
	strategicGoal?: string;
	createdByAgentId: string;
	createdAt: string;
	posts: KbbPost[];
}

export interface StrategicThreadSeed {
	agentId: string;
	profile: IdentityVector;
	strategicGoals?: string[];
	now?: string;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
}

export class KatalaBulletinBoard {
	private threads: KbbThread[];

	constructor(threads: KbbThread[] = []) {
		this.threads = [...threads];
	}

	createThread(
		input: Omit<KbbThread, "id" | "posts"> & { body?: string },
	): KbbThread {
		const id = `kbb_${slug(input.title)}_${this.threads.length + 1}`;
		const posts: KbbPost[] = input.body
			? [
					{
						id: `${id}_post_1`,
						authorAgentId: input.createdByAgentId,
						body: input.body,
						createdAt: input.createdAt,
					},
				]
			: [];
		const thread: KbbThread = { ...input, id, posts };
		this.threads.push(thread);
		return thread;
	}

	addPost(
		threadId: string,
		authorAgentId: string,
		body: string,
		createdAt: string,
	): KbbPost {
		const thread = this.threads.find((item) => item.id === threadId);
		if (!thread) throw new Error(`Unknown KBB thread: ${threadId}`);
		const post: KbbPost = {
			id: `${threadId}_post_${thread.posts.length + 1}`,
			authorAgentId,
			body,
			createdAt,
		};
		thread.posts.push(post);
		return post;
	}

	createStrategicThreads(seed: StrategicThreadSeed): KbbThread[] {
		const now = seed.now ?? new Date().toISOString();
		const focus = seed.profile.professionalFocus.length
			? seed.profile.professionalFocus
			: ["general-alignment"];
		const goals = seed.strategicGoals?.length
			? seed.strategicGoals
			: ["strategic alignment"];

		return focus.map((topic, index) =>
			this.createThread({
				title: `Agent alignment: ${topic}`,
				tags: ["agent", "alignment", topic],
				strategicGoal: goals[index % goals.length],
				createdByAgentId: seed.agentId,
				createdAt: now,
				body: `Autonomous thread for ${topic}: ${goals[index % goals.length]}`,
			}),
		);
	}

	listThreads(): KbbThread[] {
		return this.threads.map((thread) => ({
			...thread,
			posts: [...thread.posts],
			tags: [...thread.tags],
		}));
	}

	toJSON(): string {
		return JSON.stringify(
			{ schema: "katala.kbb.v1", threads: this.threads },
			null,
			2,
		);
	}

	static fromJSON(json: string): KatalaBulletinBoard {
		const parsed = JSON.parse(json) as { threads?: KbbThread[] };
		return new KatalaBulletinBoard(parsed.threads ?? []);
	}
}

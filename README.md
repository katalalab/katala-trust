# Katala Trust (OSS verification sidecar)

Lab-neutral verification for AI agents: detox intent, score trust, mediate,
and emit fail-closed recommendations — without owning host memory or execution.

> Private R&D monorepo stays separate. This repository is the public, measurable cut.

## Verified baseline — 2026-08-28

Typecheck and local verification pass: 149 core tests, 65 gateway tests, and 30/30 trust-eval cases. The dependency audit reports zero known vulnerabilities after refreshing the lockfile.

This host approval boundary is the carry-forward point for historical KS/KQ candidates: they may propose evidence, but only `allow` / `block` / `ask-human` owns host action.

## Quick start

```bash
npm install
npm run verify:local

printf '%s' '{"request_id":"smoke","host":{"name":"local","session_id":"manual"},"task":{"goal":"verify Katala think surface","mode":"review"},"context_items":[],"capabilities":{"can_write":false,"can_shell":false,"can_network":false},"workspace":{"read_paths":[],"write_paths":[]},"memory_mode":"none"}' \
  | npm run katala:think --silent
```

## Host embed chain

1. `sanitizeThinkRequest` — drop PRIVATE/IGNORE (`contextSanitizer.mjs`)
2. `toolArgsToThinkRequest` — map host tool args (`openClawToolAdapter.mjs`)
3. `katala:think` — verification block on stdout
4. `decideHostAction` — allow / block / ask-human (`hostApprovalGate.mjs`)
5. Optional skill: `skills/katala-think/SKILL.md`

Eval non-regression: `evals/trust-claims-v1.jsonl` via `npm run verify:trust-eval`.

## Docs

- [Industry landscape (2026-07)](docs/industry/INDUSTRY_LANDSCAPE_2026-07.md)
- [Parts assembly](docs/industry/PARTS_ASSEMBLY.md)
- [Host embed notes](docs/industry/HOST_EMBED_NOTES_2026-08-01.md)
- [Thought engine contract](docs/openclaw/KATALA_THOUGHT_ENGINE_CONTRACT.md)
- [Safe embedding](docs/openclaw/OPENCLAW_SAFE_EMBEDDING.md)

## License

MIT

# Katala Trust (OSS verification sidecar)

katala-trustは、エージェントが外部ツールを呼び出したり操作を行ったりする際に、その妥当性を検査して判定の推奨を返す軽量な検証サイドカーです。ホスト側の実行権限やプロセスの管理を直接引き受けるのではなく、入力内容を検査して許可や確認、拒絶といった判定結果を提示します。

シェルコマンドの実行やファイル変更を試みるエージェントに対し独立したプロセスから判定推奨を得たい場面や、エージェントフレームワークに標準入出力経由で呼び出せる検査ステップを追加したい場面に向いています。

返されるのは判定の推奨結果にすぎず、実際の実行を停止または許可する最終的な判断はホスト側で行われます。未知のプロンプトインジェクションなど汎用的な攻撃防止が実証されているわけではありません。

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

# 依存関係・CI の運用

2026-10-03、#84 / #85 / #88 / #93 対応。

`bun install --frozen-lockfile` で lockfile を再現し、`bun run audit:dependencies` で開発・optional・間接依存を含む全 npm package/version を npm advisory API と OSV に照合する。どちらかの API が失敗した場合や、期限切れの例外がある場合も失敗として扱う。監査結果を保存する場合は `bun run audit:dependencies --output /tmp/dependency-audit.json` を使う。パッケージ名とバージョンのみを監査サービスへ送る。

セキュリティ修正では Hono、React Router、DOMPurify、Vitest を修正版に更新した。`package.json` の override は修正版未満を含む間接依存を固定するために導入した。PostCSS の更新により nanoid 3 系も修正版へ進む。Next.js は better-auth の optional peer 由来で、この製品は Next.js サーバーを起動しない。sharp は Miniflare 由来の開発・テスト依存である。2026-10-08: GHSA-wq5f-xc86-pv6w の修正版 librsvg を含めるため sharp を 0.35.5 に固定した。undici は Wrangler/Miniflare 由来の開発用依存で 7 系を維持する。

Vitest は Workers pool の互換範囲にある 4.1 系を維持した。Vite/TypeScript/認証基盤の major 更新や、最新 Workers pool が要求する Miniflare 5 alpha への移行は今回のセキュリティ修正と分ける。未使用であることを確認した bcryptjs、その型定義、React Form、Vite basic-ssl を除去した。

唯一の一時例外は `scripts/security-exceptions.json` に記録する。例外は GHSA ID、package、**正確な版**、理由、追跡 Issue、UTC の有効期限を必須とする。新たな脆弱性や更新された版へ自動で引き継がない。esbuild 0.18.20 は drizzle-kit の旧 loader に残る。対象の開発サーバー API は利用していないが、loader を強制更新せず、2026-11-02 までに上流対応または互換性を検証した置換で除去する。

`bun run test:tooling` は lockfile の scope/複数版、修正版境界、例外の版限定と期限を確認する。`.github/workflows/quality.yml` は Node 22 / Bun 1.3.13 を固定し、監査、型、Worker 統合テスト、SPA/Worker ビルドを実行する。Actions は確認済み commit SHA で固定する。本番 secret は使用しない。ブランチ保護で Quality の `verify` を必須にする設定は GitHub 管理者が行う。

Turbo はルート `.env` / `.env.*` を `globalDependencies`、ビルド時の `VITE_*` を `env` としてハッシュに含める。これは Vite の `envDir` がリポジトリルートを指すため。`.wrangler` はローカル D1 状態を含むので成果物キャッシュから除外した。Cloudflare の資格情報は deploy にのみ pass-through し、build のキャッシュキーへ含めない。root build は SPA に加え、API Worker の `wrangler deploy --dry-run` も実行する。

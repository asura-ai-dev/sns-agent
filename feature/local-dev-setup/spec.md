# ローカル開発環境セットアップ - Specification

## 目的

clone → `pnpm dev` → ブラウザで動作確認、までを誰でも迷わず完了できる状態にする。現状は `.env` 未作成、DB 未初期化、Web→API proxy 未設定のため、初回起動で必ずエラーになる。

## 主要機能

1. **`.env` 自動生成スクリプト**: `.env.example` をベースに、開発用デフォルト値を埋めた `.env` を生成。ENCRYPTION_KEY は自動生成。
2. **DB 初期化の一本化**: マイグレーション + seed を 1 コマンドで実行できるスクリプト。
3. **Web → API proxy**: Next.js の rewrites で `/api/*` を API サーバー (3001) に転送。
4. **開発ドキュメント**: `docs/development.md` にセットアップ手順・起動方法・トラブルシュートを記載。
5. **style jsx 修正のコミット**: 既に実施済みの `<style jsx>` → `<style>` 修正を含む。

## 受け入れ条件

- `pnpm run setup` （または同等のコマンド）で .env 生成 + DB 初期化が完了する
- `pnpm dev` で Web (3000) + API (3001) が同時起動する
- ブラウザで `/settings/accounts` を開き、接続ボタン押下で API に到達する（OAuth プロバイダ未設定でも 4xx エラー、接続タイムアウトではない）
- `docs/development.md` が存在し、clone → 起動 → 動作確認の手順が記載されている

## 非機能要件

- OAuth プロバイダの実キー不要でローカル起動可能（プロバイダ未設定時は graceful に警告）
- 既存の CI / build を壊さない

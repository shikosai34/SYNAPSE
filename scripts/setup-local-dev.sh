#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

ensure_flag() {
  file=$1
  key=$2
  value=$3
  if ! grep -Eq "^[[:space:]]*${key}[[:space:]]*=" "$file"; then
    # 2026-09-27: 既存のローカル設定を保ったまま、欠けている開発専用フラグだけ末尾へ追加する。
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [ ! -e .env ]; then
  cp .env.example .env
fi

ensure_flag .env ENABLE_EMAIL_PASSWORD true
ensure_flag .env VITE_ENABLE_LOCAL_AUTH true

dev_vars=apps/api/.dev.vars
if [ -L "$dev_vars" ]; then
  target=$(readlink "$dev_vars")
  if [ "$target" != "../../.env" ]; then
    printf '%s\n' "Preserving existing apps/api/.dev.vars symlink; ensure it contains the local development flags."
  fi
elif [ -e "$dev_vars" ]; then
  # Wrangler reads a regular .dev.vars file instead of the root .env, so add only missing local flags there too.
  ensure_flag "$dev_vars" ENABLE_EMAIL_PASSWORD true
  ensure_flag "$dev_vars" VITE_ENABLE_LOCAL_AUTH true
else
  ln -s ../../.env "$dev_vars"
fi

if [ "${1:-}" = "--env-only" ]; then
  printf '%s\n' "Local environment files are ready. Existing values were preserved."
  exit 0
fi

if [ "$#" -gt 0 ]; then
  printf '%s\n' "Unknown option: $1" >&2
  exit 2
fi

printf '%s\n' "Applying local D1 migrations..."
bun run db:migrate:local
printf '%s\n' "Seeding the reproducible local demo workspace..."
bun scripts/seed-local-dev.ts
printf '%s\n' "Local development setup is ready. Start the API and app with bun run dev:api and bun run dev:app."

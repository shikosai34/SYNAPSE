/**
 * 2026-07-07 (Phase6): `cn` 実装 (border-thin/thick/heavy を tailwind-merge の
 * border-width グループに登録するカスタムマージ) は register/visitor で完全に重複しており、
 * 同じバグ修正 (border-thick が border-border に潰される問題) を2回行った経緯がある。
 * @fesflow/config/cn へ共有化し、ここでは re-export するだけにする
 * (`@/lib/utils` からの既存 import を壊さないため)。
 */
export { cn } from "@fesflow/config/cn";

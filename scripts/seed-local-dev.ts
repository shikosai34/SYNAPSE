// 2026-09-27: 拡張設定画面も同じデモを読むため、有効フラグだけでなく既存のmanifest契約を満たす。
const demoMods = JSON.stringify({ installed: { "circle-pre-order-cod": {
  manifest: { id: "circle-pre-order-cod", name: "事前注文", description: "ローカル確認用の事前注文", version: "1.0.0", settingsSchema: [], hooks: {} },
  enabled: true, settings: {},
} } });

const sql = `
INSERT OR IGNORE INTO event (id, event_name, start_date, end_date, lifecycle_status)
VALUES ('dev-demo-event', 'FesFlow Demo Festival',
  CAST(unixepoch('now', '-1 day') * 1000 AS INTEGER),
  CAST(unixepoch('now', '+30 days') * 1000 AS INTEGER), 'live');

INSERT OR IGNORE INTO circle (id, event_id, name, description, mods, settings)
VALUES ('dev-demo-circle', 'dev-demo-event', 'Demo Kitchen', 'Local development sample workspace',
  '${demoMods}', '{}');

-- 2026-09-27: 旧セットアップが入れた不完全なデモ設定だけを補修し、利用者の編集値は保持する。
UPDATE circle SET mods = '${demoMods}'
WHERE id = 'dev-demo-circle' AND mods = '{"installed":{"circle-pre-order-cod":{"enabled":true}}}';

INSERT OR IGNORE INTO membership (id, user_email, user_name, event_id, role, is_active)
VALUES ('dev-demo-event-membership', 'demo@example.invalid', 'Demo Manager', 'dev-demo-event', 'event_manager', 1);

INSERT OR IGNORE INTO membership (id, user_email, user_name, circle_id, role, is_active)
VALUES ('dev-demo-circle-membership', 'demo@example.invalid', 'Demo Manager', 'dev-demo-circle', 'circle_manager', 1);

INSERT OR IGNORE INTO menu (id, circle_id, name, price, image_path, description, sold_out, stock_quantity, inventory_enabled)
VALUES ('dev-demo-menu', 'dev-demo-circle', 'Demo Yakisoba', 600, '', 'Local sample item for register and inventory checks', 0, 12, 1);

INSERT OR IGNORE INTO event_user (id, event_id, display_id, status, nickname)
VALUES ('dev-demo-visitor', 'dev-demo-event', 1, 'available', 'デモ来場者');

INSERT OR IGNORE INTO wristband (id, user_id, status)
VALUES ('dev-demo-wristband', 'dev-demo-visitor', 'active');
`;

const command = Bun.spawn(
  ["bunx", "wrangler", "d1", "execute", "fesflow-db", "--local", "--command", sql],
  { cwd: new URL("../apps/api", import.meta.url).pathname, stdout: "ignore", stderr: "inherit" },
);
const result = await command.exited;
if (result !== 0) throw new Error("Local demo seed failed; no remote database was targeted.");

console.log("Seeded the local demo festival, circle, memberships, menu item, visitor, and wristband.");

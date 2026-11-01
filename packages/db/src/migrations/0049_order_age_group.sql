ALTER TABLE `orders` ADD `age_group` text;--> statement-breakpoint
-- 2026-11-01: 既存注文の年代を、注文と同一イベントの来場者代表プロフィールから補完する。
-- 家族共通アカウントの個々の購入者は判別できないため、バンド年代から推測して埋めない。
UPDATE `orders` SET `age_group` = (
  SELECT u.age_group
  FROM event_user u
  INNER JOIN circle c ON c.event_id = u.event_id
  WHERE u.id = orders.user_id AND c.id = orders.circle_id
)
WHERE orders.user_id IS NOT NULL AND orders.age_group IS NULL;

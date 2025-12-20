# **02\. APIインターフェース仕様**

## **1\. 基本方針 (Standards)**

* **Base URL:** https://api.shikosai.net (Hono Server)  
* **Protocol:** HTTP/1.1 or HTTP/2 (over Cloudflare)  
* **Data Format:** JSON (Content-Type: application/json)  
* **Response Schema:** 成功・失敗に関わらず統一されたエンベロープを使用する。

### **統一レスポンス形式**

// Success  
{ "success": true, "data": { ... } }

// Error  
{ "success": false, "error": { "code": "INVALID\_CODE", "message": "..." } }

## **2\. エンドポイント設計**

### **2.1 Auth & Onboarding**

| Method | Path | Auth | 概要 |
| :---- | :---- | :---- | :---- |
| POST | /v1/auth/visitor | None | リストバンドUUIDでログイン。セッション有効期限は**7日間**。 |
| POST | /v1/auth/staff/join | User | 店舗招待QRコードを送信し、その店舗のスタッフ権限(ShopMember)を取得する。 |
| POST | /v1/auth/staff/register | User | パスキー(WebAuthn)登録開始。 |

### **2.2 Staff POS (Offline First)**

| Method | Path | Auth | 概要 |
| :---- | :---- | :---- | :---- |
| POST | /v1/staff/sync | Staff | **\[重要\]** オフライン売上データのBulk送信。冪等性担保。 |
| GET | /v1/staff/shops | Staff | 自分が所属している店舗の一覧とマスタデータを取得。 |
| POST | /v1/staff/gacha | Staff | アイテムドロップ判定。 |

### **2.3 Staff Ticket Management (Online Only)**

整理券の管理・モード切替  
| Method | Path | Auth | 概要 |  
| :--- | :--- | :--- | :--- |  
| PATCH| /v1/staff/config/ticket| Staff | モード切替

is\_ticket\_active (発券中フラグ) を手動でON/OFFする。 |  
| POST | /v1/staff/tickets/call | Staff | 呼び出し (順番待ちの場合)

「次の番号」をRedis/DBにセットし、WebSocketで通知。 |  
| POST | /v1/staff/tickets/verify| Staff | 消し込み・入場

客のチケットQRをスキャン。

force: true オプションで時間外・定員オーバーでも強制入場可能。 |

### **2.4 Visitor App**

| Method | Path | Auth | 概要 |
| :---- | :---- | :---- | :---- |
| GET | /v1/visitor/trends | None | **Cache-Control: public, max-age=60** トレンド情報取得。 |
| GET | /v1/visitor/me | Visitor | **Cache-Control: private, no-store** チケット数、スタンプ状況取得。 |
| POST | /v1/visitor/reviews | Visitor | レビュー投稿＆チケット付与。 |
| POST | /v1/visitor/tickets | Visitor | **整理券発行** Redisカウンター(順番待ち) または 枠在庫(時間指定) を消費して発券。 |
| GET | /v1/visitor/tickets | Visitor | 自分の持っている整理券の状態と、現在の呼び出し状況を確認。 |

### **2.5 WebSocket (Realtime)**

| Path | 概要 | Event (S-\>C) |
| :---- | :---- | :---- |
| /ws/stage | OBS制御用 (Local LAN Only) | SCENE\_SWITCH, SHOW\_ALERT |
| /ws/signage | サイネージ配信 | PROMOTION\_AD (空き店舗情報) TICKET\_UPDATE (呼び出し番号更新) |

## **3\. セキュリティ & ミドルウェア仕様**

### **3.1 認証バイパス (Localhost / Private Network)**

開発効率と当日の緊急対応のため、以下の条件では認証をスキップまたは特権を付与する。

* **条件:** リクエスト元IPが 127.0.0.1 または Zone C (制御用LAN 192.168.100.0/24) のIP帯域であること。  
* **挙動:** 管理画面APIへのアクセスを無条件で許可する。

### **3.2 CORS**

* **Allowed Origins:** \*.shikosai.net, localhost:\*
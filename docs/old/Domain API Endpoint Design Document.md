# **ドメイン・APIエンドポイント設計書**

## **1\. ドメイン構成 (DNS Strategy)**

\*\*「システムは資産、コンテンツはアーカイブ」\*\*という思想に基づき、システム系ドメインは永続化（バージョン番号なし）し、広報用サイトのみ開催回数でバージョン管理を行う。

| サブドメイン | URL例 | 接続先 (Hosting) | 用途・アクセス制限 |
| :---- | :---- | :---- | :---- |
| **(Root)** | https://34.shikosai.net | **Cloudflare Pages** | **対外向け公式サイト** (Astro) ※ここだけ毎年 35, 36 と増えていく。 https://shikosai.net はその年の \[num\] へリダイレクトさせる。 **\[制限\] Public (なし)** |
| **api** | https://api.shikosai.net | **Cloudflare Tunnel** | **Hono Backend** (本部PC) 全てのAPIリクエストの受け口。 フロントエンド（Pages）からはここを叩く。 **\[制限\] Token Verification \+ CORS** |
| **staff** | https://staff.shikosai.net | **Cloudflare Pages** | **店舗用POSアプリ** (React PWA) 永続ドメイン。毎年アプリを更新してデプロイする。 **\[制限\] App Level (Store QR / Passkey)** |
| **visitor** | https://visitor.shikosai.net | **Cloudflare Pages** | **来場者用マイページ** (React PWA) 永続ドメイン。 **\[制限\] App Level (UUID Scan)** |
| **admin** | https://admin.shikosai.net | **Cloudflare Pages** | **本部・ステージ管理画面 \[制限\] Cloudflare Zero Trust (Access)** 開発チームのメールアドレス認証がないとアクセス自体できないようにする。 |

### **運用上の注意点 (PWA Cache)**

staff や visitor は同じURLで中身が毎年入れ替わるため、前年のService Workerがブラウザに残っていると「古いアプリが表示される」事故が起きる。

* **対策:** アプリ起動時に必ず window.applicationCache やService Workerのバージョンチェックを行い、不整合があれば強制リロード（unregister）するロジックを実装すること。

## **2\. APIエンドポイント設計 (REST / WebSocket)**

バックエンドはHonoのモノリス構成だが、ルートパスによって責務と認証ミドルウェアを分ける。

### **2.1 共通・認証系 (/v1/auth)**

| Method | Path | 説明 | Payload / Res |
| :---- | :---- | :---- | :---- |
| **POST** | /v1/auth/visitor | **来場者ログイン (QRスキャン)** リストバンドの署名(UUID)を検証し、Session Cookieを発行。 | req: { qr\_token: "..." } res: { user\_id: "uuid", nickname: "..." } |
| **POST** | /v1/auth/staff/join | **店員参加 (店舗QRスキャン)** 店舗固有の招待コードを送信し、スタッフ権限を得る。 | req: { invite\_code: "..." } |
| **POST** | /v1/auth/staff/register | **店員端末登録** WebAuthn登録フローを開始。 | \- |

### **2.2 店舗POS系 (/v1/staff)**

**※オフライン動作前提のため、通信回復時の「まとめ送り」に対応する。**

| Method | Path | 説明 | Payload / Res |
| :---- | :---- | :---- | :---- |
| **POST** | /v1/staff/sync | **トランザクション同期 (Bulk)** オフライン中に溜まった売上データを送信。 **冪等性担保:** uuid が重複していたら無視する。 | req: { transactions: \[{ uuid: "...", item\_id: "...", timestamp: 170... }, ...\] } |
| **GET** | /v1/staff/items | **商品マスタ取得** 起動時に取得し、IndexedDBにキャッシュ。 | res: { items: \[{ id: "yakisoba", price: 300 }, ...\] } |
| **POST** | /v1/staff/gacha | **アイテムドロップ判定** スキャン時に抽選を行う。 | res: { dropped: true, item: "stage\_jack\_ticket" } |

### **2.3 整理券管理系 (/v1/staff/tickets) \[New\]**

**※整理券機能はオンライン必須**

| Method | Path | 説明 | Payload / Res |
| :---- | :---- | :---- | :---- |
| **PATCH** | /config/ticket | **モード切替** 整理券発券中フラグの手動ON/OFF。 | req: { active: true } |
| **POST** | /call | **呼び出し** 「次の番号」を更新し、WebSocketで通知。 | req: { next\_number: 105 } |
| **POST** | /verify | **消し込み・入場** 客のチケットQRをスキャン。 force: true で強制入場可。 | req: { ticket\_id: "..." } |

### **2.4 来場者系 (/v1/visitor)**

**※DB負荷対策のため、Redisキャッシュを積極的に返す。**

| Method | Path | 説明 | Payload / Res |
| :---- | :---- | :---- | :---- |
| **GET** | /v1/visitor/trends | **トレンドマップ情報** 1分ごとの集計結果(JSON)を返す。 **Cache-Control: public, max-age=60** | res: { spots: \[{ id: 1, heat\_level: 5 }, ...\] } |
| **GET** | /v1/visitor/me | **自分情報の取得** スタンプ、抽選券数など。 | res: { stamps: \[1, 5, 8\], lottery\_tickets: 3 } |
| **POST** | /v1/visitor/reviews | **レビュー投稿** スキャン済み店舗のみ投稿可。 | req: { spot\_id: 1, rating: 5, tags: \["tasty"\] } |
| **POST** | /v1/visitor/tickets | **整理券発行** Redisカウンターまたは在庫枠を消費して発券。 | req: { shop\_id: "..." } |

### **2.5 制御・WebSocket系 (/ws, /v1/control)**

| Method | Path | 説明 | Payload / Res |
| :---- | :---- | :---- | :---- |
| **WS** | /ws/stage | **OBS制御用WebSocket** OBS側のスクリプトが接続し、メッセージを待機。 | msg: { type: "SCENE\_SWITCH", scene: "JACKPOT" } |
| **WS** | /ws/signage | **サイネージ配信** 空き店舗情報などをプッシュ。 | msg: { type: "PROMOTION", text: "..." } msg: { type: "TICKET\_UPDATE", ... } |
| **POST** | /v1/control/jack | **ステージジャック実行** サークルがアイテムを使用した際に叩く。 | req: { item\_id: "..." } |

## **3\. CORS設定 (Security)**

Honoサーバー (api.shikosai.net) に設定すべきCORSポリシー。  
他のドメインからのfetchを拒否する。  
app.use('\*', cors({  
  origin: \[  
    // 本番環境  
    '\[https://34.shikosai.net\](https://34.shikosai.net)', // 公式サイト（今年は34）  
    '\[https://staff.shikosai.net\](https://staff.shikosai.net)',  
    '\[https://visitor.shikosai.net\](https://visitor.shikosai.net)',  
    '\[https://admin.shikosai.net\](https://admin.shikosai.net)',  
    // 開発用  
    'http://localhost:5173',   
  \],  
  allowMethods: \['POST', 'GET', 'OPTIONS'\],  
  allowHeaders: \['Content-Type', 'Authorization'\],  
  credentials: true,  
}))  

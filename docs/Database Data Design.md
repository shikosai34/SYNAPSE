# **01\. データベース・データ設計**

## **1\. ポリシー**

* **Single Source of Truth:** 全ての永続化データは単一の PostgreSQL インスタンスで管理する。  
* **Schema Flexibility:** 設定やログ詳細は JSONB カラムを活用し、スキーマ変更コストを下げる。  
* **Timezone:** DB内部はすべて UTC で保存する。

## **2\. ER図 (Schema)**

erDiagram  
    Users ||--o{ ShopMembers : "belongs\_to"  
    Shops ||--o{ ShopMembers : "has\_staff"  
    Users ||--o{ Authenticators : "owns\_device"  
      
    Users ||--o{ Transactions : initiates  
    Shops ||--o{ Transactions : processes  
    Users ||--o{ Visits : logs  
    Users ||--o{ Reviews : posts  
    Users ||--o{ LotteryTickets : holds  
    LotteryTickets ||--o{ LotteryWinners : results  
      
    Shops ||--o{ NumberedTickets : issues  
    Users ||--o{ NumberedTickets : queues  
    Shops ||--|{ ShopTicketConfig : configures

    Users {  
        uuid id PK "UUID (Listband / Staff ID)"  
        string nickname  
        string role "visitor | staff | admin"  
        jsonb preferences  
        timestamp created\_at  
    }  
    Shops {  
        string id PK "store\_yakisoba"  
        string display\_name  
        string invite\_code "スタッフ招待用"  
        jsonb menu "商品マスタ"  
        jsonb modifiers "トッピング定義"  
        jsonb inventory "運営アイテム所持数"  
        jsonb config "店舗設定"  
    }  
    ShopMembers {  
        uuid user\_id PK  
        string shop\_id PK  
        string role "owner | member"  
        timestamp joined\_at  
    }  
    Transactions {  
        uuid id PK "Client UUID (Idempotency Key)"  
        uuid user\_id FK  
        string shop\_id FK  
        jsonb items "購入スナップショット"  
        int total\_amount  
        timestamp offline\_created\_at  
        timestamp synced\_at  
    }  
    Visits {  
        uuid user\_id PK  
        string shop\_id PK  
        timestamp created\_at  
    }  
    Reviews {  
        int id PK  
        uuid user\_id FK  
        string shop\_id FK  
        int rating  
        jsonb tags  
        text comment  
    }  
    LotteryTickets {  
        uuid id PK  
        uuid user\_id FK  
        string source\_type "獲得理由"  
        string source\_id "重複防止用ID"  
        boolean is\_used  
    }  
    NumberedTickets {  
        uuid id PK  
        string type "sequential | timeslot"  
        string shop\_id FK  
        uuid user\_id FK  
        int ticket\_number  
        timestamp slot\_start  
        timestamp slot\_end  
        string status "waiting | called | completed | expired | cancelled"  
        timestamp issued\_at  
    }  
    ShopTicketConfig {  
        string shop\_id PK  
        boolean is\_ticket\_active "手動切替フラグ"  
        int capacity\_per\_slot  
        int slot\_duration\_minutes  
    }  
    Authenticators {  
        bytea id PK "Credential ID"  
        uuid user\_id FK  
        bytea public\_key  
        string device\_name  
    }

## **3\. Redis キャッシュ戦略**

DB負荷軽減およびカウンター管理のため、以下のキーをRedisで管理する。

| Key Pattern | Type | TTL | 用途 |
| :---- | :---- | :---- | :---- |
| trend:ranking | JSON | 60s | 直近のヒートマップ集計結果。 |
| session:{session\_id} | JSON | **7days** | ログインセッション情報 (User ID, Role, 所属Shop一覧)。 |
| draft\_order:{uuid} | JSON | 24h | 来場者の事前注文ドラフト。 |
| ticket:{shop\_id}:next | Int | \- | 整理券の発券カウンター (Atomic Increment)。 |
| ticket:{shop\_id}:current | Int | \- | 現在呼び出し中の番号。 |


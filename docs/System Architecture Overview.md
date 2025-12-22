# **00\. システムアーキテクチャ概要**

## **1\. プロジェクト目的**

* **Core Value:** 「待たせない・迷わせない・止まらない」  
* **Scope:** 3,000人規模のイベントにおけるPOSレジ、来場者アプリ、整理券システム、演出制御の統合管理。  
* **Mission:** エッジ・クラウド分散処理およびオフライン・ファーストの実証実験 (PBL)。

## **2\. 全体構成図 (High-Level Architecture)**

「モノリス・バックエンド \+ マイクロ・フロントエンド」 構成を採用する。  
全てのフロントエンドはCloudflare Pagesから配信され、API通信のみが本部サーバーへ到達する。  
graph TD  
    subgraph Clients  
        StaffApp\[("📱 Staff POS / Ticket\<br\>Zone A (Cellular)")\]  
        VisitorApp\[("📱 Visitor App\<br\>Zone A (Cellular)")\]  
        StageCtrl\[("💻 Stage Controller\<br\>Zone C (Local LAN)")\]  
    end

    subgraph Edge \["☁️ Cloudflare Edge"\]  
        CDN\[("Pages / CDN\<br\>(shikosai.net)")\]  
        Tunnel\[("Tunnel Endpoint\<br\>(api.shikosai.net)")\]  
    end

    subgraph HQ \["🏢 本部サーバー (Docker Compose)"\]  
        Hono\[("🔥 Hono Server\<br\>(Monolith API)")\]  
        DB\[("🐘 PostgreSQL")\]  
        Redis\[("🔴 Redis Cache")\]  
        Mtx\[("🎥 MediaMTX")\]  
    end

    StaffApp \--\> CDN  
    VisitorApp \--\> CDN  
      
    StaffApp \--"API (Offline Sync)"--\> Tunnel  
    VisitorApp \--"API (Cacheable)"--\> Tunnel  
    Tunnel \--\> Hono  
      
    Hono \--\> DB  
    Hono \--\> Redis  
      
    StageCtrl \--"WebSocket (Local)"--\> Hono

## **3\. ドメイン構成 (DNS Strategy)**

* **Public Site:** https://34.shikosai.net (Astro / SSG)  
* **API:** https://api.shikosai.net (Hono / Tunnel)  
* **Apps:**  
  * https://visitor.shikosai.net (Visitor PWA)  
  * https://staff.shikosai.net (Staff PWA)  
  * https://admin.shikosai.net (Admin Dashboard)

## **4\. リポジトリ構成 (Monorepo)**

Turborepo を使用し、型定義と設定を共有する。

```bash
/  
├── apps/  
│   ├── backend/       \# Hono (API, WebSocket, Batch)  
│   ├── staff-app/     \# React PWA (店員用: POS \+ 整理券管理)  
│   ├── visitor-app/   \# React PWA (来場者用: マップ \+ 整理券発行)  
│   ├── admin-web/     \# React SPA (管理・ステージ用)  
│   └── website/       \# Astro (対外向け公式サイト)  
├── packages/  
│   ├── db/            \# Prisma Schema & Client  
│   ├── contract/      \# Shared Types & API Schema  
│   └── ui/            \# 共通UIコンポーネント (Tailwind)  
└── infra/             \# Docker Compose, Nginx, Scripts  
```

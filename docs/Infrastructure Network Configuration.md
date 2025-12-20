# **04\. インフラ・ネットワーク構成**

## **1\. 物理ネットワーク (Zone Topology)**

信頼度別に3つのセグメントを構築する。

| Zone | 用途 | 接続 | ゲートウェイ |
| :---- | :---- | :---- | :---- |
| **Zone A** | **Public Service** (App/POS) | 楽天モバイル / Wi-Fi | **あり** (Internet Access) |
| **Zone B** | **Streaming** (YouTube) | 学内有線LAN | **あり** (Uplink Only) |
| **Zone C** | **Control / Video** (Internal) | 独自敷設ハブ | **なし** (Closed Network) |

## **2\. サーバーノード構成**

### **Node 1: Server PC (Brain)**

* **接続:** Zone A (Wi-Fi) \+ Zone C (LAN .10)  
* **Services:**  
  * hono-backend: API & WebSocket  
  * postgres: DB  
  * redis: Cache  
  * cloudflared: Tunnel Endpoint

### **Node 2: Stream PC (Face)**

* **接続:** Zone B (LAN 1\) \+ Zone C (LAN 2 .20)  
* **Services:**  
  * obs-studio: Streaming & Composition  
  * mediamtx: Internal Signage Server (RTMP \-\> HLS)

## **3\. デプロイフロー**

* **Frontend:** git push \-\> Cloudflare Pages (Auto Build)  
* **Backend:** git push \-\> GitHub Actions \-\> GHCR \-\> Watchtower (Auto Pull & Restart)  
* **Edge (Pi):** 本部PC上の Local Registry 経由でイメージ配布 (Pull型)。  
* **Emergency:** インターネット遮断時は、Node 1内の Local Registry 経由で手動デプロイ可能。
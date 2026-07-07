
import { useEffect, useRef, useState, useMemo } from "react";

interface ModSandboxProps {
  modId: string;
  hookName: string;
  html?: string;
  jsUrl?: string;
  cssUrl?: string;
  data?: any; // モッドに渡す初期データ / リアルタイム更新データ
  onAction?: (actionType: string, payload: any) => void;
}

export function ModSandbox({
  modId,
  hookName,
  html = "",
  jsUrl = "",
  cssUrl = "",
  data = {},
  onAction,
}: ModSandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState("0px");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;
  const initialDataRef = useRef(data);

  // メッセージの受信処理 (子から親へ)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // 開発時は localhost:3000 または localhost:3001 からの postMessage のみを安全に許可
      // sandbox 属性により origin は "null" になるため、データ構造で判定する
      const msg = event.data;
      if (!msg || typeof msg !== "object" || msg.source !== "fesorder-mod") {
        return;
      }

      // 送信元のモッドIDとフック名が一致している場合のみ処理
      if (msg.modId !== modId || msg.hookName !== hookName) {
        return;
      }

      switch (msg.type) {
        case "RESIZE":
          if (typeof msg.height === "number" && !isFullscreenRef.current) {
            setIframeHeight(`${msg.height}px`);
          }
          break;
        case "ACTION":
          if (msg.actionType === "SET_FULLSCREEN") {
            setIsFullscreen(!!msg.payload?.enabled);
          }
          if (onAction && msg.actionType) {
            onAction(msg.actionType, msg.payload);
          }
          break;
        default:
          console.warn("[ModSandbox] Unknown message type:", msg.type);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [modId, hookName, onAction]);

  // 親から子へのデータ変更伝達 (FESORDER_UPDATE)
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      // sandbox="allow-scripts" のため、targetOrigin は "*" にせざるを得ないが、
      // 内部に機密情報を含まないように、親側で安全にフィルタリングされたデータのみを送信する
      iframeRef.current.contentWindow.postMessage(
        {
          type: "FESORDER_UPDATE",
          data,
        },
        "*"
      );
    }
  }, [data]);

  // iframe の srcDoc に流し込む HTML テンプレートを生成
  // srcDoc をメモ化することで、data の変更時に iframe がリロードされるのを防ぎます
  const srcDoc = useMemo(() => {
    const sdkScript = `
      (function() {
        var modId = ${JSON.stringify(modId)};
        var hookName = ${JSON.stringify(hookName)};
        var currentData = ${JSON.stringify(initialDataRef.current)};
        var listeners = [];

        // FesOrderSDK グローバルオブジェクトの定義
        window.FesOrderSDK = {
          modId: modId,
          hookName: hookName,
          getData: function() { return currentData; },
          onUpdate: function(callback) {
            listeners.push(callback);
            // 初期データを即時渡す
            if (currentData) {
              callback(currentData);
            }
          },
          sendAction: function(actionType, payload) {
            window.parent.postMessage({
              source: "fesorder-mod",
              modId: modId,
              hookName: hookName,
              type: "ACTION",
              actionType: actionType,
              payload: payload
            }, "*");
          }
        };

        // 親からのデータ更新イベント受信
        window.addEventListener("message", function(event) {
          var msg = event.data;
          if (msg && msg.type === "FESORDER_UPDATE") {
            currentData = msg.data;
            listeners.forEach(function(cb) {
              try { cb(currentData); } catch(e) { console.error(e); }
            });
          }
        });

        // ResizeObserver による自動リサイズ送信
        window.addEventListener("load", function() {
          var lastHeight = 0;
          var ro = new ResizeObserver(function(entries) {
            var height = document.documentElement.scrollHeight || document.body.scrollHeight;
            if (height !== lastHeight && height > 0) {
              lastHeight = height;
              window.parent.postMessage({
                source: "fesorder-mod",
                modId: modId,
                hookName: hookName,
                type: "RESIZE",
                height: height
              }, "*");
            }
          });
          ro.observe(document.documentElement);
        });
      })();
    `;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <!--
            2026-07-06: (監査M-2) サークル管理者が設定した任意HTML/JSを実行するmodサンドボックスに
            制限的なCSPを追加。iframeはsandbox="allow-scripts"（allow-same-origin無し）で
            オリジン分離済みだが、親と同一サークルを見る他ユーザーへのフィッシングUI表示・
            外部への情報送信・マイニング等を緩和するため、mod内で許可する通信先を最小限に絞る。
            特に connect-src 'none' により fetch/XHR/WebSocket 等の外部通信を全面遮断する。
            これは情報流出緩和の要となる一方、外部APIを利用する正規modを壊す可能性がある
            トレードオフであることに留意（現状リポジトリ内に connect を要求するサンプルmodは
            見当たらないため 'none' を採用）。
          -->
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https://fonts.googleapis.com https:; font-src https://fonts.gstatic.com https: data:; img-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';" />
          <!-- Google Fontsの読み込み (DESIGN.md用) -->
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Mono:wght@400;700&family=Work+Sans:wght@400;600&display=swap" rel="stylesheet">
          
          ${cssUrl ? `<link rel="stylesheet" href="${cssUrl}" />` : ""}
          <style>
            html, body {
              margin: 0;
              padding: 0;
              background: transparent;
              overflow: hidden;
            }
          </style>
        </head>
        <body>
          <div id="mod-root">${html}</div>
          <script>${sdkScript}</script>
          ${jsUrl ? `<script src="${jsUrl}"></script>` : ""}
        </body>
      </html>
    `;
  }, [modId, hookName, html, jsUrl, cssUrl]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      style={
        isFullscreen
          ? {
              position: "fixed",
              // inset:0 + width/height:100% を使う (100vw はスクロールバー幅を含み横あふれの原因になるため)
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              background: "transparent",
              zIndex: 9999,
              overflow: "hidden",
            }
          : {
              width: "100%",
              height: iframeHeight,
              border: "none",
              background: "transparent",
              transition: "height 0.15s ease-out",
              overflow: "hidden",
            }
      }
      title={`Mod Sandbox - ${modId} (${hookName})`}
    />
  );
}

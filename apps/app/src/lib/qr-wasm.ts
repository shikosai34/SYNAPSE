import { setZXingModuleOverrides } from "@yudiel/react-qr-scanner";
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

// 2026-10-23: @yudiel/react-qr-scanner は BarcodeDetector 非対応端末 (iOS Safari 等) で
// zxing-wasm にフォールバックするが、WASM の既定取得先が jsDelivr CDN になっている。
// 会場の混雑した回線やオフライン PWA では初回読み込みが遅い/失敗するため、
// 自前ビルドに同梱した WASM を配信して CDN 依存をなくす。
// (zxing-wasm はライブラリ内部と同一バージョンに固定している。ズレると WASM の ABI が合わない)
setZXingModuleOverrides({
	locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? zxingReaderWasmUrl : prefix + path),
});

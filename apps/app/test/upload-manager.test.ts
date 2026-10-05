import { beforeEach, describe, expect, it, mock } from "bun:test";

// 2026-10-05 Issue #97: 認証付きアップロード API は実通信せず差し替え、マネージャの状態遷移だけを検証する。
let uploadImpl: (file: File) => Promise<{ path: string; fileName: string }>;
// mock.module はファイルをまたいで残るため、他テスト (asset-url など) が使う getApiBaseUrl を潰さないよう
// 本物のモジュールを展開して uploadImage だけ差し替える。
const realApi = await import("../src/lib/api");
mock.module("@/lib/api", () => ({ ...realApi, uploadImage: (file: File) => uploadImpl(file) }));

const mgr = await import("../src/lib/upload-manager");

const png = () => new File(["x"], "a.png", { type: "image/png" });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("upload-manager", () => {
  beforeEach(() => {
    mgr.__resetUploadManager();
    uploadImpl = async () => ({ path: "/api/uploads/a.png", fileName: "a.png" });
  });

  it("runs commit after upload even when the caller's onUploaded is a no-op (modal closed)", async () => {
    const commit = mock(async (_path: string) => {});
    mgr.startUpload({ file: png(), label: "メニュー画像", commit });
    await flush();
    expect(commit).toHaveBeenCalledWith("/api/uploads/a.png");
    expect(mgr.isUploadActive()).toBe(false);
  });

  it("reports active phases while the upload is in flight", async () => {
    let release!: () => void;
    uploadImpl = () =>
      new Promise((res) => {
        release = () => res({ path: "/p", fileName: "a.png" });
      });
    mgr.startUpload({ file: png(), label: "x", entityKey: "menu:1:image" });
    expect(mgr.isUploadActive()).toBe(true);
    // 変換の要否判定 (await) を挟んでから uploadImage が呼ばれるため、一周待つ
    await flush();
    release();
    await flush();
    expect(mgr.isUploadActive()).toBe(false);
  });

  it("keeps the job as error and allows retry", async () => {
    let calls = 0;
    uploadImpl = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { path: "/p", fileName: "a.png" };
    };
    const commit = mock(async (_p: string) => {});
    const id = mgr.startUpload({ file: png(), label: "x", commit });
    await flush();
    expect(commit).not.toHaveBeenCalled();
    mgr.retryUpload(id);
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("marks the job as error when commit fails", async () => {
    mgr.startUpload({ file: png(), label: "x", commit: async () => { throw new Error("save failed"); } });
    await flush();
    expect(mgr.isUploadActive()).toBe(false);
  });
});

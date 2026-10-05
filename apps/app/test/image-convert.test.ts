import { describe, expect, it } from "bun:test";
import { prepareImageForUpload, sniffImageFormat } from "../src/lib/image-convert";

const bytes = (...n: number[]) => new Uint8Array(n);
const ftyp = (brand: string) =>
  new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0))]);

describe("sniffImageFormat", () => {
  it("detects common formats from magic bytes", () => {
    expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe("png");
    expect(sniffImageFormat(ftyp("heic"))).toBe("heic");
    expect(sniffImageFormat(ftyp("mif1"))).toBe("heic");
    expect(sniffImageFormat(bytes(1, 2, 3))).toBe("unknown");
  });
});

describe("prepareImageForUpload", () => {
  it("passes through non-HEIC files untouched", async () => {
    const f = new File(["x"], "a.png", { type: "image/png" });
    expect(await prepareImageForUpload(f)).toBe(f);
  });

  it("does not convert a JPEG that Safari left named .HEIC, and fixes the extension", async () => {
    const f = new File([bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)], "IMG_1.HEIC", { type: "image/heic" });
    const out = await prepareImageForUpload(f, () => {
      throw new Error("should not convert");
    });
    expect(out.name).toBe("IMG_1.jpg");
    expect(out.type).toBe("image/jpeg");
  });
});

import { describe, expect, it } from "vitest";
import { decodeProcessChunk } from "./log-decoder.js";

describe("decodeProcessChunk", () => {
  it("keeps utf-8 process output unchanged", () => {
    expect(decodeProcessChunk(Buffer.from("Dev Cockpit 路径 D:\\个人", "utf8"))).toBe("Dev Cockpit 路径 D:\\个人");
  });

  it("falls back to gb18030 for Chinese Windows code page output", () => {
    const gbkBytes = Buffer.from([0x44, 0x3a, 0x5c, 0xd6, 0xd0, 0xce, 0xc4, 0xc2, 0xb7, 0xbe, 0xb6]);

    expect(decodeProcessChunk(gbkBytes)).toBe("D:\\中文路径");
  });
});

import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, before, after } from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  emptyLibrary,
  mergeLegacyStickerMap,
  readStickerLibrary,
  withLibraryLock,
  writeStickerLibrary,
  type StickerLibraryFile,
} from "./library.js";

function mockApi(dir: string): OpenClawPluginApi {
  return {
    id: "tg-sticker-reply",
    resolvePath: (rel: string) => path.join(dir, rel),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as OpenClawPluginApi;
}

describe("mergeLegacyStickerMap", () => {
  it("adds entries with meaning legacy:alias", () => {
    const base: StickerLibraryFile = { version: 1, stickers: [] };
    const next = mergeLegacyStickerMap(base, { ok: "CAAC_ok", laugh: "CAAC_laugh" });
    assert.equal(next.stickers.length, 2);
    assert.ok(next.stickers.some((s) => s.meaning === "legacy:ok" && s.fileId === "CAAC_ok"));
  });

  it("skips duplicate file_id", () => {
    const base: StickerLibraryFile = {
      version: 1,
      stickers: [{ id: "a", fileId: "FID1", meaning: "x", createdAt: "2020-01-01T00:00:00.000Z" }],
    };
    const next = mergeLegacyStickerMap(base, { b: "FID1" });
    assert.equal(next.stickers.length, 1);
  });
});

describe("library persistence", () => {
  let dir: string;
  let api: OpenClawPluginApi;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-sticker-lib-"));
    api = mockApi(dir);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("roundtrips write and read", async () => {
    const data: StickerLibraryFile = {
      version: 1,
      stickers: [
        {
          id: "s1",
          fileId: "CAAC_test",
          meaning: "hello",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    await writeStickerLibrary(api, data);
    const read = await readStickerLibrary(api);
    assert.equal(read.stickers.length, 1);
    assert.equal(read.stickers[0]?.id, "s1");
    assert.equal(read.stickers[0]?.fileId, "CAAC_test");
  });

  it("withLibraryLock runs mutations sequentially", async () => {
    const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-sticker-lock-"));
    const api2 = mockApi(lockDir);
    try {
      let counter = 0;
      const p1 = withLibraryLock(async () => {
        const c = counter;
        counter += 1;
        await new Promise((r) => setTimeout(r, 20));
        const lib = await readStickerLibrary(api2);
        await writeStickerLibrary(api2, {
          ...lib,
          stickers: [
            ...lib.stickers,
            { id: `id-${c}`, fileId: `F-${c}`, meaning: "m", createdAt: "2026-01-01T00:00:00.000Z" },
          ],
        });
      });
      const p2 = withLibraryLock(async () => {
        const lib = await readStickerLibrary(api2);
        await writeStickerLibrary(api2, {
          ...lib,
          stickers: [
            ...lib.stickers,
            { id: "id-last", fileId: "F-last", meaning: "m2", createdAt: "2026-01-01T00:00:00.000Z" },
          ],
        });
      });
      await Promise.all([p1, p2]);
      const finalLib = await readStickerLibrary(api2);
      assert.ok(finalLib.stickers.length >= 2);
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  });
});

describe("emptyLibrary", () => {
  it("returns version and empty stickers", () => {
    const e = emptyLibrary();
    assert.equal(e.stickers.length, 0);
    assert.equal(e.version, 1);
  });
});

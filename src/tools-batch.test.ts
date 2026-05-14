import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, before, after } from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createStickerTools } from "./tools.js";

function mockApi(dir: string): OpenClawPluginApi {
  return {
    id: "tg-sticker-reply",
    resolvePath: (rel: string) => path.join(dir, rel),
    pluginConfig: {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as OpenClawPluginApi;
}

describe("tg_sticker_batch_update", () => {
  let dir: string;
  let api: OpenClawPluginApi;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-sticker-batch-"));
    api = mockApi(dir);
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("updates multiple meanings in one call", async () => {
    const tools = createStickerTools(api);
    const batch = tools.find((t) => t.name === "tg_sticker_batch_update");
    assert.ok(batch);
    const add = tools.find((t) => t.name === "tg_sticker_add");
    assert.ok(add);
    await add!.execute("", {
      fileId: "FID_A",
      meaning: "old a",
      id: "a1",
    });
    await add!.execute("", {
      fileId: "FID_B",
      meaning: "old b",
      id: "b2",
    });
    const r = await batch!.execute("", {
      updates: [
        { id: "a1", meaning: "greeting warm" },
        { id: "b2", meaning: "awkward silence", notes: "op hint" },
      ],
    });
    assert.equal(r.details.status, "ok");
    const get = tools.find((t) => t.name === "tg_sticker_get");
    const g1 = await get!.execute("", { id: "a1" });
    assert.match(String(g1.content[0]?.text), /greeting warm/);
    const g2 = await get!.execute("", { id: "b2" });
    assert.match(String(g2.content[0]?.text), /awkward silence/);
    assert.match(String(g2.content[0]?.text), /op hint/);
  });

  it("returns not_found when all ids unknown", async () => {
    const tools = createStickerTools(api);
    const batch = tools.find((t) => t.name === "tg_sticker_batch_update");
    assert.ok(batch);
    const r = await batch!.execute("", {
      updates: [{ id: "nope_nope", meaning: "x" }],
    });
    assert.equal(r.details.status, "not_found");
  });

  it("allows notes-only patch", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "tg-sticker-batch-notes-"));
    const api2 = mockApi(d);
    try {
      const tools = createStickerTools(api2);
      const add = tools.find((t) => t.name === "tg_sticker_add")!;
      const batch = tools.find((t) => t.name === "tg_sticker_batch_update")!;
      await add.execute("", { fileId: "FID_N", meaning: "keep me", id: "n1" });
      const r = await batch.execute("", { updates: [{ id: "n1", notes: "only notes" }] });
      assert.equal(r.details.status, "ok");
      const get = tools.find((t) => t.name === "tg_sticker_get")!;
      const g = await get.execute("", { id: "n1" });
      assert.match(String(g.content[0]?.text), /keep me/);
      assert.match(String(g.content[0]?.text), /only notes/);
    } finally {
      await fs.rm(d, { recursive: true, force: true });
    }
  });
});

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PluginStickerConfig, StickerLibraryFile } from "./library.js";
import { buildStickerPrependReminder } from "./prompt.js";

const emptyLib: StickerLibraryFile = { version: 1, stickers: [] };
const oneSticker: StickerLibraryFile = {
  version: 1,
  stickers: [
    {
      id: "hi",
      fileId: "CAACAgIAAxkBAA",
      meaning: "greeting",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("buildStickerPrependReminder", () => {
  it("returns undefined for system_only", () => {
    const cfg: PluginStickerConfig = { stickerPromptNudge: "system_only" };
    assert.equal(buildStickerPrependReminder(oneSticker, cfg), undefined);
  });

  it("returns undefined when no catalog and search hint disabled", () => {
    const cfg: PluginStickerConfig = { enableStickerSearchHint: false };
    assert.equal(buildStickerPrependReminder(emptyLib, cfg), undefined);
  });

  it("includes tg_sticker_send when catalog non-empty and default nudge", () => {
    const text = buildStickerPrependReminder(oneSticker, {});
    assert.ok(text);
    assert.match(text, /tg_sticker_send/);
    assert.match(text, /catalog/);
  });

  it("still nudges when catalog empty but sticker-search hint on", () => {
    const text = buildStickerPrependReminder(emptyLib, { enableStickerSearchHint: true });
    assert.ok(text);
    assert.match(text, /Catalog is empty/);
  });
});

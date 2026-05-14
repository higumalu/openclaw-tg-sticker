import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStickerSetName } from "./sticker-set.js";

describe("parseStickerSetName", () => {
  it("parses addstickers https URL", () => {
    assert.equal(parseStickerSetName("https://t.me/addstickers/chikawa_meme"), "chikawa_meme");
  });

  it("parses addstickers URL without scheme", () => {
    assert.equal(parseStickerSetName("t.me/addstickers/hello_world"), "hello_world");
  });

  it("parses trailing slash", () => {
    assert.equal(parseStickerSetName("https://t.me/addstickers/pack_name/"), "pack_name");
  });

  it("accepts plain set name", () => {
    assert.equal(parseStickerSetName("Animals"), "Animals");
    assert.equal(parseStickerSetName("set_123"), "set_123");
  });

  it("returns undefined for invalid input", () => {
    assert.equal(parseStickerSetName(""), undefined);
    assert.equal(parseStickerSetName("https://t.me/stickerpack/foo"), undefined);
    assert.equal(parseStickerSetName("bad name"), undefined);
  });
});

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGetStickerSetUrl,
  buildSendStickerUrl,
  getStickerSetDirect,
  resolveTelegramApiRoot,
  resolveTelegramBotToken,
  sendStickerDirect,
} from "./telegram-send.js";

describe("resolveTelegramBotToken", () => {
  it("reads top-level botToken", () => {
    const t = resolveTelegramBotToken(
      { channels: { telegram: { botToken: "abc:DEF" } } },
      undefined,
    );
    assert.equal(t, "abc:DEF");
  });

  it("prefers account botToken when accountId matches", () => {
    const t = resolveTelegramBotToken(
      {
        channels: {
          telegram: {
            botToken: "default:TOKEN",
            accounts: { alt: { botToken: "alt:TOKEN" } },
          },
        },
      },
      "alt",
    );
    assert.equal(t, "alt:TOKEN");
  });
});

describe("resolveTelegramApiRoot", () => {
  it("defaults to api.telegram.org", () => {
    assert.equal(resolveTelegramApiRoot({ channels: { telegram: {} } }), "https://api.telegram.org");
  });

  it("trims trailing slash on apiRoot", () => {
    assert.equal(
      resolveTelegramApiRoot({ channels: { telegram: { apiRoot: "https://proxy.example/bot-api/" } } }),
      "https://proxy.example/bot-api",
    );
  });
});

describe("sendStickerDirect", () => {
  it("POSTs JSON and maps Telegram errors", async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      assert.match(url, /\/bottest-token\/sendSticker$/);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.chat_id, -1001);
      assert.equal(body.sticker, "CAAC_test");
      return new Response(JSON.stringify({ ok: false, description: "bad sticker" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const r = await sendStickerDirect({
      apiRoot: "https://api.telegram.org",
      botToken: "test-token",
      chatId: -1001,
      stickerFileId: "CAAC_test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.telegramDescription, "bad sticker");
    }
  });

  it("omits message_thread_id for general topic 1", async () => {
    let seen: Record<string, unknown> = {};
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seen = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await sendStickerDirect({
      apiRoot: "https://api.telegram.org",
      botToken: "t",
      chatId: 1,
      stickerFileId: "s",
      messageThreadId: 1,
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal("message_thread_id" in seen, false);
  });

  it("supports form-urlencoded body (curl -d style)", async () => {
    let contentType = "";
    let bodyStr = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const h = init?.headers;
      if (h instanceof Headers) {
        contentType = h.get("content-type") ?? "";
      } else if (h && typeof h === "object") {
        contentType = String((h as Record<string, string>)["content-type"] ?? "");
      }
      bodyStr = String(init?.body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await sendStickerDirect({
      apiRoot: "https://api.telegram.org",
      botToken: "tok",
      chatId: 6881850644,
      stickerFileId: "CAAC_test_file",
      bodyEncoding: "form",
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.match(contentType, /application\/x-www-form-urlencoded/i);
    assert.ok(bodyStr.includes("chat_id=6881850644"));
    assert.ok(bodyStr.includes("sticker="));
  });
});

describe("buildSendStickerUrl", () => {
  it("joins api root and token path", () => {
    assert.equal(
      buildSendStickerUrl("https://api.telegram.org", "A:B"),
      "https://api.telegram.org/botA:B/sendSticker",
    );
  });
});

describe("buildGetStickerSetUrl", () => {
  it("joins api root and getStickerSet path", () => {
    assert.equal(
      buildGetStickerSetUrl("https://api.telegram.org", "A:B"),
      "https://api.telegram.org/botA:B/getStickerSet",
    );
  });
});

describe("getStickerSetDirect", () => {
  it("POSTs name and maps stickers", async () => {
    const fetchImpl = async (url: string, init?: RequestInit) => {
      assert.match(url, /\/botTEST\/getStickerSet$/);
      assert.equal(JSON.parse(String(init?.body)).name, "my_pack");
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            name: "my_pack",
            title: "My Pack",
            stickers: [
              { file_id: "AAA", emoji: "😀" },
              { file_id: "BBB", emoji: "" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const r = await getStickerSetDirect({
      apiRoot: "https://api.telegram.org",
      botToken: "TEST",
      stickerSetName: "my_pack",
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.name, "my_pack");
      assert.equal(r.title, "My Pack");
      assert.equal(r.stickers.length, 2);
      assert.equal(r.stickers[0]?.fileId, "AAA");
      assert.equal(r.stickers[0]?.emoji, "😀");
      assert.equal(r.stickers[1]?.position, 1);
    }
  });

  it("maps Telegram errors", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ ok: false, description: "STICKERSET_INVALID" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await getStickerSetDirect({
      apiRoot: "https://api.telegram.org",
      botToken: "T",
      stickerSetName: "nope",
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.telegramDescription, "STICKERSET_INVALID");
    }
  });
});

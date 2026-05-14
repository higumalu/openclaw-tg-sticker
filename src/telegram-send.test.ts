import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSendStickerUrl,
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
});

describe("buildSendStickerUrl", () => {
  it("joins api root and token path", () => {
    assert.equal(
      buildSendStickerUrl("https://api.telegram.org", "A:B"),
      "https://api.telegram.org/botA:B/sendSticker",
    );
  });
});

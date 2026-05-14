/** Telegram Bot API sendSticker — token / apiRoot resolution and HTTP call (no OpenClaw action block). */

export type SendStickerParams = {
  apiRoot: string;
  botToken: string;
  chatId: string | number;
  stickerFileId: string;
  messageThreadId?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type SendStickerResult =
  | { ok: true; telegramOk: true; description?: string }
  | { ok: false; error: string; telegramDescription?: string };

function getTelegramChannel(runtimeCfg: unknown): Record<string, unknown> | undefined {
  if (!runtimeCfg || typeof runtimeCfg !== "object") {
    return undefined;
  }
  const c = runtimeCfg as Record<string, unknown>;
  const ch = c.channels;
  if (!ch || typeof ch !== "object" || ch === null) {
    return undefined;
  }
  const tg = (ch as Record<string, unknown>).telegram;
  if (!tg || typeof tg !== "object" || tg === null) {
    return undefined;
  }
  return tg as Record<string, unknown>;
}

/** Resolve bot token from channels.telegram (account-aware) or top-level. */
export function resolveTelegramBotToken(runtimeCfg: unknown, accountId?: string): string | undefined {
  const tg = getTelegramChannel(runtimeCfg);
  if (!tg) {
    return undefined;
  }
  if (accountId && typeof tg.accounts === "object" && tg.accounts !== null) {
    const acc = (tg.accounts as Record<string, unknown>)[accountId];
    if (acc && typeof acc === "object" && acc !== null) {
      const t = (acc as Record<string, unknown>).botToken;
      if (typeof t === "string" && t.trim()) {
        return t.trim();
      }
    }
  }
  const top = tg.botToken;
  if (typeof top === "string" && top.trim()) {
    return top.trim();
  }
  return undefined;
}

/** Bot API root (no trailing slash). */
export function resolveTelegramApiRoot(runtimeCfg: unknown): string {
  const tg = getTelegramChannel(runtimeCfg);
  const raw =
    tg && typeof tg.apiRoot === "string" && tg.apiRoot.trim()
      ? tg.apiRoot.trim().replace(/\/+$/, "")
      : "https://api.telegram.org";
  return raw;
}

export function buildSendStickerUrl(apiRoot: string, botToken: string): string {
  const root = apiRoot.replace(/\/+$/, "");
  return `${root}/bot${botToken}/sendSticker`;
}

/** Telegram rejects message_thread_id=1 for general topic in some sends; omit in that case. */
export function shouldIncludeMessageThreadId(threadId: string | number | undefined): boolean {
  if (threadId === undefined || threadId === null) {
    return false;
  }
  if (threadId === 1 || threadId === "1") {
    return false;
  }
  return true;
}

export async function sendStickerDirect(params: SendStickerParams): Promise<SendStickerResult> {
  const { apiRoot, botToken, chatId, stickerFileId, messageThreadId, signal } = params;
  const fetchFn = params.fetchImpl ?? globalThis.fetch;
  const url = buildSendStickerUrl(apiRoot, botToken);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    sticker: stickerFileId,
  };
  if (shouldIncludeMessageThreadId(messageThreadId)) {
    const t = messageThreadId;
    const n = typeof t === "number" ? t : Number(String(t));
    if (!Number.isNaN(n)) {
      body.message_thread_id = n;
    }
  }
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    return { ok: false, error: `network_error: ${String(e)}` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: `telegram_http_${res.status}: non-JSON response` };
  }
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const ok = obj.ok === true;
  const desc = typeof obj.description === "string" ? obj.description : undefined;
  if (!ok) {
    return { ok: false, error: "telegram_api_error", telegramDescription: desc ?? `http_${res.status}` };
  }
  return { ok: true, telegramOk: true, description: desc };
}

import type { PluginStickerConfig, StickerLibraryFile } from "./library.js";

function maskFileId(fileId: string): string {
  if (fileId.length <= 16) {
    return `${fileId.slice(0, 4)}…`;
  }
  return `${fileId.slice(0, 8)}…${fileId.slice(-6)}`;
}

/** Short, high-salience nudge (prependContext) so models actually consider tools before free-text replies. */
export function buildStickerPrependReminder(lib: StickerLibraryFile, pluginCfg: PluginStickerConfig): string | undefined {
  if (pluginCfg.stickerPromptNudge === "system_only") {
    return undefined;
  }
  const hasCatalog = lib.stickers.length > 0;
  const search = pluginCfg.enableStickerSearchHint !== false;
  if (!hasCatalog && !search) {
    return undefined;
  }
  const lines = [
    "[Telegram stickers — decide before you answer]",
    "1) Read the latest user message: is it casual/social (greet, thanks, joke, sympathy, celebrate, light closure)?",
    hasCatalog
      ? "2) If YES and one row in the sticker **catalog** (system section below) clearly matches that tone, you **should** call tool **`tg_sticker_send`** with that row's **`id`** (or raw **`file_id`** if the host exposed it for this bot) in this same assistant turn (tool first or short text then tool is fine). Then add a brief text reply if needed."
      : "2) Catalog is empty: do **not** invent sticker sends; you may use sticker-search fallback only if enabled in system guidance.",
    "3) If the user asked for facts/code/legal/medical/plain text only, or no catalog row fits, **skip** stickers and answer normally.",
    "4) If **`tg_sticker_send`** is not in your available tools list, you cannot send stickers — answer with text only (do not pretend you sent a sticker).",
    "5) Never emit a channel `sticker` JSON block in the same turn if you already called `tg_sticker_send`.",
    "6) Catalog **`meaning`** may be generic after a pack import — still match against the user's described intent when the operator has refined meanings.",
  ];
  return lines.join("\n");
}

export function buildTelegramStickerPromptSection(
  lib: StickerLibraryFile,
  pluginCfg: PluginStickerConfig,
): string {
  const maxLines = pluginCfg.maxCatalogLines ?? 40;
  const slice = lib.stickers.slice(0, Math.max(1, Math.min(500, maxLines)));
  const catalogLines =
    slice.length > 0
      ? slice.map((s) => `- id=\`${s.id}\` meaning=${JSON.stringify(s.meaning)} file_id=${maskFileId(s.fileId)}`)
      : ["- _(empty library — register stickers via tg_sticker_add)_"];

  const overflow =
    lib.stickers.length > slice.length
      ? `\n… ${lib.stickers.length - slice.length} more entries not shown; use tool tg_sticker_list / tg_sticker_get.`
      : "";

  const searchHint =
    pluginCfg.enableStickerSearchHint !== false
      ? [
          "",
          "Fallback when no catalog entry fits: use host action `sticker-search` with a short `query` and small `limit`, then either call `tg_sticker_send` with the resolved library id if you imported it, or use the legacy `sticker` channel action with the returned `file_id`.",
          "Prefer catalog + `tg_sticker_send` over sticker-search when both could work.",
        ].join("\n")
      : "";

  return [
    "## Telegram sticker reply policy (plugin tg-sticker-reply)",
    "",
    "### Preferred delivery: tool `tg_sticker_send`",
    "- **Primary path:** call **`tg_sticker_send`** with the sticker **library `id`** (from the catalog below), **or** with raw **`file_id`** for this bot (same payload shape as curl `sendSticker`). Uses Telegram Bot API `sendSticker` directly and does **not** rely on OpenClaw sticker action JSON blocks.",
    "- **After** a successful `tg_sticker_send`, write your normal assistant text. Do **not** also emit a `action: \"sticker\"` channel block in the same turn (avoids double-send).",
    "- `tg_sticker_send` only works when the tool run has a Telegram **delivery target** (`deliveryContext.to`). It sends to that chat only.",
    "",
    "### When to send a sticker (be proactive in social turns)",
    "- At most **one** sticker delivery per reply unless the user explicitly asks for multiple.",
    "- **When** the user is greeting, thanking, joking, sympathizing, celebrating, or closing casually **and** a catalog `meaning` clearly fits that moment, you **should prefer** calling **`tg_sticker_send`** over sending only plain text (unless the user opted out of stickers/emojis).",
    "- If the reply is primarily technical steps, legal/medical, or the user asked for plain text only, **do not** send a sticker.",
    "- If no catalog meaning matches well, **skip** the sticker (or use sticker-search fallback per rules below).",
    "",
    "### Sticker `file_id` validity (same bot — critical)",
    "- A Telegram **`file_id` is not a portable global ID**. It is only valid for **the same bot** that issued or last observed that file in Bot API context. `file_id` strings taken from **another bot**, a spreadsheet, or the web **will usually fail** with `sendSticker` / channel sticker sends for **this** gateway bot.",
    "- **Public sticker packs:** use **`tg_sticker_import_pack`** with `https://t.me/addstickers/<name>` (or the set name). Bot API **`getStickerSet`** returns `file_id`s your bot can use for **`tg_sticker_send`** without the user forwarding each sticker.",
    "- **After bulk import:** auto `meaning` fields are placeholders (emoji/title/index). The **operator** should describe each sticker's conversational use in OpenClaw; you apply patches with **`tg_sticker_batch_update`** (preferred for many ids) or **`tg_sticker_update`** per id from **`tg_sticker_list`**.",
    "- **Single custom stickers:** have the user **forward the sticker to this bot** (or process it in a chat where this bot already received it), read the `file_id` from **that** inbound/update payload, then register with **`tg_sticker_add`**. The library stores `file_id` so **this** bot can resend later via **`tg_sticker_send`**.",
    "- Third-party / copyrighted packs (e.g. popular character video stickers): you typically **cannot** mint a new pack as the operator; if the pack has a public `addstickers` link, **import** it; otherwise you still need a **`file_id` your bot is allowed to reuse** after the sticker was seen through **this** bot.",
    "- **Video / animated formats** may be skipped or limited in some inbound pipelines; prefer **static `.webp` stickers`** when reliability matters.",
    "",
    "### Fallback: OpenClaw channel `sticker` action (optional)",
    "If you cannot use `tg_sticker_send` (e.g. tool not allowed), you may still use a parseable channel action block **instead of** the tool, not in addition:",
    "```",
    "{",
    '  action: "sticker",',
    '  channel: "telegram",',
    '  to: "<from session / delivery context>",',
    '  fileId: "<full file_id from tg_sticker_get or sticker-search>",',
    "}",
    "```",
    "That path requires `channels.telegram.actions.sticker: true`. Static .webp stickers are most reliable.",
    "Use `[[reply_to_current]]` when reply threading should anchor to the triggering message.",
    "",
    "### Catalog (meaning → sticker; `file_id` must be valid for this bot)",
    ...catalogLines,
    overflow,
    "",
    "### Tools",
    "- `tg_sticker_import_pack`: bulk-add from a **public** pack URL `https://t.me/addstickers/<name>` or set name (Bot API `getStickerSet`; no forward needed).",
    "- `tg_sticker_batch_update` / `tg_sticker_update`: fix catalog **`meaning`** after import or when operator clarifies usage.",
    "- `tg_sticker_list` / `tg_sticker_get`: inspect the library; **`tg_sticker_send`** uses the library `id` (not only `file_id`).",
    searchHint,
  ]
    .filter(Boolean)
    .join("\n");
}

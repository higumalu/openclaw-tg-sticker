import type { PluginStickerConfig, StickerLibraryFile } from "./library.js";

function maskFileId(fileId: string): string {
  if (fileId.length <= 16) {
    return `${fileId.slice(0, 4)}…`;
  }
  return `${fileId.slice(0, 8)}…${fileId.slice(-6)}`;
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
          "Fallback when no catalog entry fits: use host action `sticker-search` with a short `query` and small `limit`, then send the returned `file_id` via `sticker` action.",
          "Prefer catalog entries over sticker-search when both could work.",
        ].join("\n")
      : "";

  return [
    "## Telegram sticker reply policy (plugin tg-sticker-reply)",
    "",
    "Prerequisites: gateway must set `channels.telegram.actions.sticker: true`. Static .webp stickers are most reliable.",
    "",
    "### Catalog (meaning → sticker)",
    ...catalogLines,
    overflow,
    "",
    "### When to send a sticker",
    "- Add at most **one** sticker action in a reply unless the user explicitly asks for multiple.",
    "- Send a sticker only when it **clearly reinforces tone** (thanks, sympathy, celebration, agreement, playful closure) without replacing needed facts or instructions.",
    "- If the reply is primarily technical steps, legal/medical, or the user asked for plain text, **do not** send a sticker.",
    "- If no catalog meaning matches well, **skip** the sticker (or use sticker-search fallback per rules above).",
    "",
    "### How to send",
    "After your normal text, include a parseable channel action block, for example:",
    "```",
    "{",
    '  action: "sticker",',
    '  channel: "telegram",',
    '  to: "<from session / delivery context>",',
    '  fileId: "<full file_id from tg_sticker_get or sticker-search>",',
    "}",
    "```",
    "Use `[[reply_to_current]]` when reply threading should anchor to the triggering message.",
    "",
    "### Tools",
    "- Use `tg_sticker_list` / `tg_sticker_get` to fetch the exact `file_id` before emitting the action.",
    searchHint,
  ]
    .filter(Boolean)
    .join("\n");
}

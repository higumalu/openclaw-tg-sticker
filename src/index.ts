import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
} from "openclaw/plugin-sdk/plugin-entry";
import { readPluginStickerConfig, readStickerLibraryCached } from "./library.js";
import { buildTelegramStickerPromptSection } from "./prompt.js";
import { createStickerTools, createTgStickerSendTool, runLegacyMigrationIfNeeded } from "./tools.js";

const PLUGIN_ID = "tg-sticker-reply";

const configSchema = buildJsonPluginConfigSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    maxCatalogLines: {
      type: "number",
      description: "Max sticker lines injected into the Telegram system prompt (1–500, default 40).",
      minimum: 1,
      maximum: 500,
    },
    enableStickerSearchHint: {
      type: "boolean",
      description: "Include sticker-search fallback guidance (default true).",
    },
    migrateLegacyStickerMap: {
      type: "boolean",
      description: "One-time style: merge legacy stickerMap from this config into data/sticker-library.json when new entries appear.",
    },
    stickerMap: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Legacy: alias → file_id. Used only when migrateLegacyStickerMap is true.",
    },
    allowExplicitChatId: {
      type: "boolean",
      description:
        "If true, tg_sticker_send accepts optional `to` only when it exactly matches deliveryContext.to (redundant explicit chat id).",
    },
    botTokenOverride: {
      type: "string",
      description: "Optional bot token for tg_sticker_send; defaults to channels.telegram from runtime config.",
    },
  },
});

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Telegram sticker reply",
  description:
    "Global sticker library (JSON), CRUD tools, optional direct Bot API send (tg_sticker_send), and Telegram-only prompt policy.",
  configSchema,
  register(api) {
    void runLegacyMigrationIfNeeded(api).catch((err) => {
      api.logger.error(`[${PLUGIN_ID}] legacy migration failed: ${String(err)}`);
    });

    api.on(
      "before_prompt_build",
      async (_event, ctx) => {
        if (ctx.messageProvider !== "telegram") {
          return;
        }
        const lib = await readStickerLibraryCached(api);
        const pc = readPluginStickerConfig(api.pluginConfig);
        if (lib.stickers.length === 0 && pc.enableStickerSearchHint === false) {
          return;
        }
        return { appendSystemContext: buildTelegramStickerPromptSection(lib, pc) };
      },
      { priority: 40 },
    );

    for (const tool of createStickerTools(api)) {
      const bound = tool;
      api.registerTool(() => bound, { name: bound.name, optional: true });
    }

    api.registerTool((tc) => createTgStickerSendTool(api, tc), { name: "tg_sticker_send", optional: true });
  },
});

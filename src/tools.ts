import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  isValidStickerId,
  mergeLegacyStickerMap,
  readLegacyStickerMap,
  readPluginStickerConfig,
  readStickerLibrary,
  readStickerLibraryCached,
  withLibraryLock,
  writeStickerLibrary,
  type StickerEntry,
  type StickerLibraryFile,
} from "./library.js";

function maskFileId(fileId: string): string {
  if (fileId.length <= 16) {
    return `${fileId.slice(0, 4)}…`;
  }
  return `${fileId.slice(0, 8)}…${fileId.slice(-6)}`;
}

function textResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function createStickerTools(api: OpenClawPluginApi) {
  const cfg = () => readPluginStickerConfig(api.pluginConfig);

  return [
    {
      name: "tg_sticker_add",
      label: "Add Telegram sticker to library",
      description:
        "Register a Telegram sticker file_id with a natural-language meaning for this gateway. Requires channels.telegram.actions.sticker enabled to send. Prefer static .webp stickers.",
      parameters: Type.Object({
        fileId: Type.String({ description: "Telegram sticker file_id (same bot context)." }),
        meaning: Type.String({ description: "What this sticker represents (for the model to match tone)." }),
        id: Type.Optional(Type.String({ description: "Optional slug id [a-zA-Z0-9_-]{1,64}; random id if omitted or invalid." })),
        notes: Type.Optional(Type.String({ description: "Operator notes (not shown to model in catalog)." })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const p = params as { fileId?: string; meaning?: string; id?: string; notes?: string };
        const fileId = typeof p.fileId === "string" ? p.fileId.trim() : "";
        const meaning = typeof p.meaning === "string" ? p.meaning.trim() : "";
        if (!fileId || !meaning) {
          return textResult("fileId and meaning are required.", { status: "invalid" as const });
        }
        let id = typeof p.id === "string" ? p.id.trim() : "";
        if (!id || !isValidStickerId(id)) {
          id = randomUUID();
        }
        const notes = typeof p.notes === "string" ? p.notes.trim() : undefined;
        return withLibraryLock(async () => {
          const lib = await readStickerLibrary(api);
          if (lib.stickers.some((s) => s.id === id)) {
            return textResult(`Sticker id "${id}" already exists.`, { status: "duplicate_id" as const, id });
          }
          if (lib.stickers.some((s) => s.fileId === fileId)) {
            return textResult("This file_id is already registered.", { status: "duplicate_file" as const });
          }
          const entry: StickerEntry = {
            id,
            fileId,
            meaning,
            notes: notes || undefined,
            createdAt: new Date().toISOString(),
          };
          const next: StickerLibraryFile = { ...lib, stickers: [...lib.stickers, entry] };
          await writeStickerLibrary(api, next);
          return textResult(
            `Registered sticker id=${id} meaning=${JSON.stringify(meaning)} file_id=${fileId}`,
            { status: "ok" as const, id, fileId, meaning },
          );
        });
      },
    },
    {
      name: "tg_sticker_update",
      label: "Update Telegram sticker metadata",
      description: "Update meaning and/or notes for an existing sticker entry by id.",
      parameters: Type.Object({
        id: Type.String({ description: "Sticker entry id." }),
        meaning: Type.Optional(Type.String({ description: "New meaning text." })),
        notes: Type.Optional(Type.String({ description: "New notes (empty string clears)." })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const p = params as { id?: string; meaning?: string; notes?: string };
        const id = typeof p.id === "string" ? p.id.trim() : "";
        if (!id) {
          return textResult("id is required.", { status: "invalid" as const });
        }
        return withLibraryLock(async () => {
          const lib = await readStickerLibrary(api);
          const idx = lib.stickers.findIndex((s) => s.id === id);
          if (idx < 0) {
            return textResult(`No sticker with id "${id}".`, { status: "not_found" as const, id });
          }
          const cur = lib.stickers[idx]!;
          const meaning =
            typeof p.meaning === "string" && p.meaning.trim() ? p.meaning.trim() : cur.meaning;
          let notes: string | undefined = cur.notes;
          if (typeof p.notes === "string") {
            notes = p.notes.trim() ? p.notes.trim() : undefined;
          }
          const updated: StickerEntry = { ...cur, meaning, notes };
          const stickers = lib.stickers.slice();
          stickers[idx] = updated;
          await writeStickerLibrary(api, { ...lib, stickers });
          return textResult(`Updated sticker id=${id}.`, { status: "ok" as const, id });
        });
      },
    },
    {
      name: "tg_sticker_remove",
      label: "Remove Telegram sticker from library",
      description: "Remove a sticker entry by id.",
      parameters: Type.Object({
        id: Type.String({ description: "Sticker entry id to remove." }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const id = typeof (params as { id?: string }).id === "string" ? (params as { id: string }).id.trim() : "";
        if (!id) {
          return textResult("id is required.", { status: "invalid" as const });
        }
        return withLibraryLock(async () => {
          const lib = await readStickerLibrary(api);
          const next = lib.stickers.filter((s) => s.id !== id);
          if (next.length === lib.stickers.length) {
            return textResult(`No sticker with id "${id}".`, { status: "not_found" as const, id });
          }
          await writeStickerLibrary(api, { ...lib, stickers: next });
          return textResult(`Removed sticker id=${id}.`, { status: "ok" as const, id });
        });
      },
    },
    {
      name: "tg_sticker_list",
      label: "List Telegram sticker library",
      description: "List registered stickers (masked file_id). Call tg_sticker_get for full file_id before sending.",
      parameters: Type.Object({}),
      async execute() {
        const lib = await readStickerLibraryCached(api);
        const max = cfg().maxCatalogLines ?? 40;
        const cap = Math.min(200, Math.max(1, max * 5));
        const slice = lib.stickers.slice(0, cap);
        const lines = slice.map(
          (s) => `- id=\`${s.id}\` meaning=${JSON.stringify(s.meaning)} file_id=${maskFileId(s.fileId)}`,
        );
        const tail =
          lib.stickers.length > cap
            ? `\n… and ${lib.stickers.length - cap} more (narrow with tg_sticker_get or remove unused).`
            : "";
        const body =
          lines.length > 0
            ? ["Sticker library:", ...lines, tail].filter(Boolean).join("\n")
            : "Sticker library is empty. Use tg_sticker_add to register stickers.";
        return textResult(body, { status: "ok" as const, count: lib.stickers.length });
      },
    },
    {
      name: "tg_sticker_get",
      label: "Get Telegram sticker file_id by id",
      description: "Return full file_id and meaning for a library entry. Use with channel sticker action when sending.",
      parameters: Type.Object({
        id: Type.String({ description: "Sticker entry id from tg_sticker_list." }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const id = typeof (params as { id?: string }).id === "string" ? (params as { id: string }).id.trim() : "";
        if (!id) {
          return textResult("id is required.", { status: "invalid" as const });
        }
        const lib = await readStickerLibraryCached(api);
        const s = lib.stickers.find((x) => x.id === id);
        if (!s) {
          return textResult(`No sticker with id "${id}".`, { status: "not_found" as const, id });
        }
        return textResult(
          [`id: ${s.id}`, `file_id: ${s.fileId}`, `meaning: ${s.meaning}`, "", "Send via channel action sticker + channel telegram + to from context."].join(
            "\n",
          ),
          { status: "ok" as const, id, fileId: s.fileId },
        );
      },
    },
  ];
}

export async function runLegacyMigrationIfNeeded(api: OpenClawPluginApi): Promise<void> {
  const pc = readPluginStickerConfig(api.pluginConfig);
  if (!pc.migrateLegacyStickerMap) {
    return;
  }
  const stickerMap = readLegacyStickerMap(api.pluginConfig);
  if (Object.keys(stickerMap).length === 0) {
    return;
  }
  await withLibraryLock(async () => {
    const lib = await readStickerLibrary(api);
    const merged = mergeLegacyStickerMap(lib, stickerMap);
    if (merged.stickers.length !== lib.stickers.length) {
      await writeStickerLibrary(api, merged);
      api.logger.info(
        `[${api.id}] Migrated ${merged.stickers.length - lib.stickers.length} legacy stickerMap entries into sticker library.`,
      );
    }
  });
}

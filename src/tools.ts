import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
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
import { parseStickerSetName } from "./sticker-set.js";
import {
  getStickerSetDirect,
  resolveTelegramApiRoot,
  resolveTelegramBotToken,
  sendStickerDirect,
  shouldIncludeMessageThreadId,
} from "./telegram-send.js";

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
        "Register one sticker by file_id (must be from this bot's context, e.g. user forwarded to the bot). For a **public sticker pack**, prefer **`tg_sticker_import_pack`** with `https://t.me/addstickers/<name>` — Bot API returns usable file_ids for this bot. Prefer static .webp. Send via tg_sticker_send or channel action.",
      parameters: Type.Object({
        fileId: Type.String({
          description:
            "Sticker file_id valid for THIS gateway bot only (from inbound/forward to this bot). Not portable from other bots.",
        }),
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
      description:
        "Update meaning and/or notes for one library entry by id. After bulk import, use **`tg_sticker_batch_update`** to patch many ids in one call.",
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
      name: "tg_sticker_batch_update",
      label: "Batch update sticker meanings/notes",
      description:
        "Apply many metadata patches in one call (max 50). Use after **`tg_sticker_import_pack`**: imported meanings are placeholders; operator refines **when to use** each sticker via natural language in OpenClaw and you patch `meaning` (and optional `notes`) per `id` from **`tg_sticker_list`**. Same rules as `tg_sticker_update`: include `notes` as empty string to clear notes.",
      parameters: Type.Object({
        updates: Type.Array(
          Type.Object({
            id: Type.String({ description: "Library entry id from tg_sticker_list." }),
            meaning: Type.Optional(
              Type.String({
                description:
                  "New conversational meaning for tg_sticker_send matching (non-empty when provided). Omit to leave unchanged.",
              }),
            ),
            notes: Type.Optional(
              Type.String({
                description: "Operator notes; omit to leave unchanged; empty string clears.",
              }),
            ),
          }),
          { minItems: 1, maxItems: 50, description: "Patches applied in order; duplicate ids use last patch." },
        ),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const raw = params as { updates?: unknown };
        if (!Array.isArray(raw.updates) || raw.updates.length === 0) {
          return textResult("updates must be a non-empty array.", { status: "invalid" as const });
        }
        const rows = raw.updates.slice(0, 50);
        type Patch = { id: string; meaning?: string; notes?: string; hasNotesKey: boolean };
        const patches: Patch[] = [];
        for (const row of rows) {
          if (!row || typeof row !== "object") {
            return textResult("Each update must be an object with id.", { status: "invalid" as const });
          }
          const r = row as Record<string, unknown>;
          const id = typeof r.id === "string" ? r.id.trim() : "";
          if (!id) {
            return textResult("Each update needs a non-empty id.", { status: "invalid" as const });
          }
          const hasMeaningKey = "meaning" in r;
          const hasNotesKey = "notes" in r;
          if (!hasMeaningKey && !hasNotesKey) {
            return textResult(
              `Update for id "${id}" must include at least one of: meaning, notes (same contract as tg_sticker_update).`,
              { status: "invalid" as const },
            );
          }
          if (hasMeaningKey && typeof r.meaning !== "string") {
            return textResult(`Update for id "${id}": meaning must be a string when provided.`, {
              status: "invalid" as const,
            });
          }
          if (hasNotesKey && typeof r.notes !== "string") {
            return textResult(`Update for id "${id}": notes must be a string when provided.`, {
              status: "invalid" as const,
            });
          }
          const meaningStr = hasMeaningKey && typeof r.meaning === "string" ? r.meaning.trim() : "";
          if (hasMeaningKey && !meaningStr && !hasNotesKey) {
            return textResult(
              `Update for id "${id}": meaning cannot be empty when it is the only field (omit meaning to keep, or add notes).`,
              { status: "invalid" as const },
            );
          }
          const patch: Patch = { id, hasNotesKey };
          if (meaningStr) {
            patch.meaning = meaningStr;
          }
          if (hasNotesKey && typeof r.notes === "string") {
            patch.notes = r.notes;
          }
          patches.push(patch);
        }

        return withLibraryLock(async () => {
          const lib = await readStickerLibrary(api);
          const stickers = lib.stickers.slice();
          const idToIndex = new Map(stickers.map((s, i) => [s.id, i] as const));
          const applied: string[] = [];
          const missing: string[] = [];
          for (const p of patches) {
            const idx = idToIndex.get(p.id);
            if (idx === undefined) {
              missing.push(p.id);
              continue;
            }
            const cur = stickers[idx]!;
            let meaning = cur.meaning;
            if (typeof p.meaning === "string" && p.meaning.trim()) {
              meaning = p.meaning.trim();
            }
            let notes: string | undefined = cur.notes;
            if (p.hasNotesKey && typeof p.notes === "string") {
              notes = p.notes.trim() ? p.notes.trim() : undefined;
            }
            stickers[idx] = { ...cur, meaning, notes };
            applied.push(p.id);
          }
          if (applied.length === 0) {
            return textResult(
              missing.length
                ? `No entries updated. Unknown id(s): ${missing.join(", ")}`
                : "No entries updated.",
              { status: "not_found" as const, applied, missing },
            );
          }
          await writeStickerLibrary(api, { ...lib, stickers });
          const lines = [
            `Applied ${applied.length} update(s).`,
            missing.length ? `Unknown id(s) (skipped): ${missing.join(", ")}` : "",
          ].filter(Boolean);
          return textResult(lines.join("\n"), {
            status: missing.length && applied.length === 0 ? ("not_found" as const) : ("ok" as const),
            applied,
            missing,
            appliedCount: applied.length,
            missingCount: missing.length,
          });
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
      description: "List registered stickers (masked file_id). Use ids with tg_sticker_batch_update / tg_sticker_update after pack import to set conversational meanings.",
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
      description:
        "Return full file_id, meaning, and optional notes for a library entry. Prefer tg_sticker_send to deliver; channel sticker action remains a fallback.",
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
          [
            `id: ${s.id}`,
            `file_id: ${s.fileId}`,
            `meaning: ${s.meaning}`,
            ...(s.notes ? [`notes: ${s.notes}`] : []),
            "",
            "Prefer tool tg_sticker_send(id) in Telegram sessions; or use channel sticker action as fallback.",
          ].join("\n"),
          { status: "ok" as const, id, fileId: s.fileId },
        );
      },
    },
  ];
}

function sanitizePackIdPrefix(setName: string): string {
  let s = setName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s) {
    s = "pack";
  }
  return s.slice(0, 40);
}

function allocatePackStickerId(prefix: string, sequence: number, existingIds: Set<string>): string {
  const num = String(sequence).padStart(3, "0");
  let base = `${prefix}_${num}`;
  if (base.length > 64) {
    base = `${prefix.slice(0, Math.max(1, 64 - 1 - num.length))}_${num}`;
  }
  if (!isValidStickerId(base)) {
    base = `p_${randomUUID().replace(/-/g, "").slice(0, 12)}_${num}`.slice(0, 64);
  }
  let candidate = base;
  let n = 0;
  while (existingIds.has(candidate)) {
    n += 1;
    const suf = `_${n}`;
    candidate = `${base.slice(0, Math.max(1, 64 - suf.length))}${suf}`;
    if (candidate.length > 64) {
      candidate = `${prefix.slice(0, 24)}_${randomUUID().slice(0, 8)}`;
    }
  }
  existingIds.add(candidate);
  return candidate;
}

function buildPackImportMeaning(title: string, setName: string, emoji: string, index1: number): string {
  const e = emoji ? `${emoji} ` : "";
  const raw = `[${title || setName}] ${e}#${index1} (pack:${setName})`;
  return raw.length > 450 ? `${raw.slice(0, 447)}...` : raw;
}

/** Import stickers from a public pack via Bot API getStickerSet (no user forward needed). */
export function createTgStickerImportPackTool(api: OpenClawPluginApi, toolCtx: OpenClawPluginToolContext) {
  const pluginCfg = () => readPluginStickerConfig(api.pluginConfig);
  return {
    name: "tg_sticker_import_pack",
    label: "Import Telegram sticker pack by link or name",
    description:
      "Fetch a **public** sticker set via Bot API getStickerSet using `https://t.me/addstickers/<set_name>` or plain set name (e.g. chikawa_meme). Registers many library entries with file_ids valid for this bot. Respects maxStickers cap; skips file_ids already in the library.",
    parameters: Type.Object({
      stickerSetLinkOrName: Type.String({
        description:
          "Sticker pack URL (https://t.me/addstickers/NAME) or Telegram set name (NAME only, [a-zA-Z0-9_]+).",
      }),
      maxStickers: Type.Optional(
        Type.Number({
          description: "Max stickers to import from the set (1–200, default 100).",
          minimum: 1,
          maximum: 200,
        }),
      ),
    }),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = params as { stickerSetLinkOrName?: string; maxStickers?: number };
      const rawInput = typeof p.stickerSetLinkOrName === "string" ? p.stickerSetLinkOrName.trim() : "";
      if (!rawInput) {
        return textResult("stickerSetLinkOrName is required.", { status: "invalid" as const });
      }
      const setName = parseStickerSetName(rawInput);
      if (!setName) {
        return textResult(
          "Could not parse sticker set name. Use https://t.me/addstickers/<name> or a plain set name (letters, digits, underscore only).",
          { status: "invalid_name" as const },
        );
      }
      let maxStickers =
        typeof p.maxStickers === "number" && Number.isFinite(p.maxStickers)
          ? Math.floor(p.maxStickers)
          : 100;
      maxStickers = Math.min(200, Math.max(1, maxStickers));

      const runtimeCfg = toolCtx.getRuntimeConfig?.() ?? api.config;
      const token =
        pluginCfg().botTokenOverride?.trim() || resolveTelegramBotToken(runtimeCfg, toolCtx.deliveryContext?.accountId);
      if (!token) {
        return textResult(
          "No bot token resolved (channels.telegram.botToken / accounts, or plugin botTokenOverride).",
          { status: "no_token" as const },
        );
      }
      const apiRoot = resolveTelegramApiRoot(runtimeCfg);
      const fetched = await getStickerSetDirect({
        apiRoot,
        botToken: token,
        stickerSetName: setName,
        signal,
      });
      if (!fetched.ok) {
        return textResult(
          `getStickerSet failed: ${fetched.error}${fetched.telegramDescription ? ` — ${fetched.telegramDescription}` : ""}`,
          {
            status: "telegram_error" as const,
            error: fetched.error,
            telegramDescription: fetched.telegramDescription,
          },
        );
      }
      const slice = fetched.stickers.slice(0, maxStickers);
      if (slice.length === 0) {
        return textResult(`Sticker set "${fetched.name}" returned no stickers.`, { status: "empty_set" as const });
      }

      return withLibraryLock(async () => {
        const lib = await readStickerLibrary(api);
        const existingFileIds = new Set(lib.stickers.map((s) => s.fileId));
        const existingIds = new Set(lib.stickers.map((s) => s.id));
        const idPrefix = sanitizePackIdPrefix(fetched.name);
        const newEntries: StickerEntry[] = [];
        const addedIds: string[] = [];
        let skippedDuplicate = 0;
        let seq = 1;
        for (const row of slice) {
          if (existingFileIds.has(row.fileId)) {
            skippedDuplicate += 1;
            continue;
          }
          const id = allocatePackStickerId(idPrefix, seq, existingIds);
          seq += 1;
          const meaning = buildPackImportMeaning(fetched.title, fetched.name, row.emoji, row.position + 1);
          const entry: StickerEntry = {
            id,
            fileId: row.fileId,
            meaning,
            notes: `import:getStickerSet:${fetched.name}`,
            createdAt: new Date().toISOString(),
          };
          newEntries.push(entry);
          existingFileIds.add(row.fileId);
          addedIds.push(id);
        }
        if (newEntries.length === 0) {
          return textResult(
            `No new stickers added (all ${slice.length} in range already in library). Set: ${fetched.title} (${fetched.name}).`,
            { status: "all_duplicates" as const, skippedDuplicate },
          );
        }
        const next: StickerLibraryFile = { ...lib, stickers: [...lib.stickers, ...newEntries] };
        await writeStickerLibrary(api, next);
        const preview = addedIds.slice(0, 12).join(", ");
        const more = addedIds.length > 12 ? ` … +${addedIds.length - 12} more` : "";
        return textResult(
          [
            `Imported ${newEntries.length} sticker(s) from "${fetched.title}" (${fetched.name}).`,
            skippedDuplicate ? `Skipped ${skippedDuplicate} already registered (same file_id).` : "",
            `New ids (sample): ${preview}${more}`,
            `Total in library: ${next.stickers.length}. Auto meanings are rough; refine with **tg_sticker_batch_update** (many ids) or **tg_sticker_update** (one id) after the operator describes each sticker's use in chat.`,
          ]
            .filter(Boolean)
            .join("\n"),
          {
            status: "ok" as const,
            setName: fetched.name,
            added: newEntries.length,
            skippedDuplicate,
            ids: addedIds,
          },
        );
      });
    },
  };
}

function resolveChatIdForSend(
  delivery: OpenClawPluginToolContext["deliveryContext"],
  paramsTo: unknown,
  pluginCfg: ReturnType<typeof readPluginStickerConfig>,
):
  | { ok: true; chatId: string | number; threadId?: string | number }
  | { ok: false; error: string } {
  const deliveryTo = delivery?.to;
  if (deliveryTo === undefined || deliveryTo === "") {
    return {
      ok: false,
      error:
        "No Telegram delivery target (chat). tg_sticker_send only works inside an active Telegram tool/session context.",
    };
  }
  if (
    pluginCfg.allowExplicitChatId === true &&
    paramsTo !== undefined &&
    paramsTo !== null &&
    String(paramsTo).trim() !== ""
  ) {
    const a = String(deliveryTo).trim();
    const b = String(paramsTo).trim();
    if (a !== b) {
      return { ok: false, error: `Parameter "to" must exactly match the current chat id (${a}).` };
    }
  }
  const s = String(deliveryTo).trim();
  const n = Number(s);
  const chatId = !Number.isNaN(n) && String(n) === s ? n : s;
  return { ok: true, chatId, threadId: delivery?.threadId };
}

export function createTgStickerSendTool(api: OpenClawPluginApi, toolCtx: OpenClawPluginToolContext) {
  const pluginCfg = () => readPluginStickerConfig(api.pluginConfig);
  return {
    name: "tg_sticker_send",
    label: "Send Telegram sticker (Bot API)",
    description:
      "POST sendSticker like curl: same bot token + chat_id + sticker file_id. Pass **library `id`** (preferred) **or** raw **`file_id`** for this bot only (e.g. from OpenClaw sticker-cache / inbound). Uses deliveryContext.to as chat unless allowExplicitChatId + matching `to`. Plugin config sendStickerBodyEncoding=form matches curl -d encoding.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Sticker library entry id (preferred)." })),
      fileId: Type.Optional(
        Type.String({
          description:
            "Raw Telegram sticker file_id for THIS bot (omit `id`). Use when the sticker exists in host cache but is not in the plugin library yet.",
        }),
      ),
      to: Type.Optional(
        Type.String({
          description:
            "Ignored unless plugins.entries.tg-sticker-reply.config.allowExplicitChatId is true; then must equal current chat id.",
        }),
      ),
    }),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = params as { id?: string; fileId?: string; to?: string };
      const id = typeof p.id === "string" ? p.id.trim() : "";
      const directFileId = typeof p.fileId === "string" ? p.fileId.trim() : "";
      if ((!id && !directFileId) || (id && directFileId)) {
        return textResult("Provide exactly one of: `id` (library entry) or `fileId` (raw sticker for this bot).", {
          status: "invalid" as const,
        });
      }
      const runtimeCfg = toolCtx.getRuntimeConfig?.() ?? api.config;
      const token =
        pluginCfg().botTokenOverride?.trim() ||
        resolveTelegramBotToken(runtimeCfg, toolCtx.deliveryContext?.accountId);
      if (!token) {
        return textResult(
          "No bot token resolved (channels.telegram.botToken / accounts, or plugin botTokenOverride).",
          { status: "no_token" as const },
        );
      }
      const apiRoot = resolveTelegramApiRoot(runtimeCfg);
      const chat = resolveChatIdForSend(toolCtx.deliveryContext, p.to, pluginCfg());
      if (!chat.ok) {
        return textResult(chat.error, { status: "no_chat" as const });
      }
      let stickerFileId = directFileId;
      if (id) {
        const lib = await readStickerLibraryCached(api);
        const sticker = lib.stickers.find((x) => x.id === id);
        if (!sticker) {
          return textResult(`No sticker with id "${id}".`, { status: "not_found" as const, id });
        }
        stickerFileId = sticker.fileId;
      }
      let messageThreadId: number | undefined;
      if (shouldIncludeMessageThreadId(chat.threadId)) {
        const t = chat.threadId!;
        const n = typeof t === "number" ? t : Number(String(t));
        messageThreadId = Number.isNaN(n) ? undefined : n;
      }
      const bodyEncoding = pluginCfg().sendStickerBodyEncoding ?? "json";
      const result = await sendStickerDirect({
        apiRoot,
        botToken: token,
        chatId: chat.chatId,
        stickerFileId,
        messageThreadId,
        signal,
        bodyEncoding,
      });
      if (!result.ok) {
        return textResult(
          `sendSticker failed: ${result.error}${result.telegramDescription ? ` — ${result.telegramDescription}` : ""}`,
          {
            status: "telegram_error" as const,
            error: result.error,
            telegramDescription: result.telegramDescription,
          },
        );
      }
      const label = id ? `id=${id}` : "fileId";
      return textResult(`Sent sticker (${label}) to chat ${String(chat.chatId)}.`, {
        status: "ok" as const,
        id: id || undefined,
        fileId: directFileId || undefined,
        chatId: chat.chatId,
      });
    },
  };
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

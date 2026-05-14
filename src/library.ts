import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export const LIBRARY_FILE_VERSION = 1;
export const DEFAULT_DATA_RELATIVE = "data/sticker-library.json";

export type StickerEntry = {
  id: string;
  fileId: string;
  meaning: string;
  notes?: string;
  createdAt: string;
};

export type StickerLibraryFile = {
  version: number;
  stickers: StickerEntry[];
};

let libraryCache: { path: string; mtimeMs: number; data: StickerLibraryFile } | null = null;

/** Serialize in-process mutations to the same library file. */
let lockChain: Promise<void> = Promise.resolve();

export function withLibraryLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  const prev = lockChain;
  lockChain = prev.then(() => next);
  return prev.then(fn, fn).finally(() => {
    release();
  });
}

export function invalidateLibraryCache(): void {
  libraryCache = null;
}

export function resolveLibraryPath(api: OpenClawPluginApi, relative = DEFAULT_DATA_RELATIVE): string {
  return api.resolvePath(relative);
}

export function emptyLibrary(): StickerLibraryFile {
  return { version: LIBRARY_FILE_VERSION, stickers: [] };
}

function parseLibrary(raw: string): StickerLibraryFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return emptyLibrary();
  }
  const obj = parsed as Record<string, unknown>;
  const stickersRaw = obj.stickers;
  if (!Array.isArray(stickersRaw)) {
    return emptyLibrary();
  }
  const stickers: StickerEntry[] = [];
  for (const row of stickersRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const fileId = typeof r.fileId === "string" ? r.fileId.trim() : "";
    const meaning = typeof r.meaning === "string" ? r.meaning.trim() : "";
    const notes = typeof r.notes === "string" ? r.notes.trim() : undefined;
    const createdAt = typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString();
    if (!id || !fileId || !meaning) continue;
    stickers.push({ id, fileId, meaning, notes: notes || undefined, createdAt });
  }
  return { version: typeof obj.version === "number" ? obj.version : LIBRARY_FILE_VERSION, stickers };
}

async function readFileMtimeMs(filePath: string): Promise<number> {
  try {
    const st = await fs.stat(filePath);
    return st.mtimeMs;
  } catch {
    return 0;
  }
}

export async function readStickerLibrary(api: OpenClawPluginApi): Promise<StickerLibraryFile> {
  const filePath = resolveLibraryPath(api);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const mtimeMs = await readFileMtimeMs(filePath);
    const data = parseLibrary(raw);
    libraryCache = { path: filePath, mtimeMs, data };
    return data;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      libraryCache = null;
      return emptyLibrary();
    }
    throw e;
  }
}

/** Read with mtime-based cache invalidation when another writer touched the file. */
export async function readStickerLibraryCached(api: OpenClawPluginApi): Promise<StickerLibraryFile> {
  const filePath = resolveLibraryPath(api);
  const mtimeMs = await readFileMtimeMs(filePath);
  if (mtimeMs === 0) {
    libraryCache = null;
    return emptyLibrary();
  }
  if (libraryCache && libraryCache.path === filePath && libraryCache.mtimeMs === mtimeMs) {
    return libraryCache.data;
  }
  return readStickerLibrary(api);
}

async function atomicWriteJson(filePath: string, data: StickerLibraryFile): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, filePath);
  invalidateLibraryCache();
}

export async function writeStickerLibrary(api: OpenClawPluginApi, data: StickerLibraryFile): Promise<void> {
  const filePath = resolveLibraryPath(api);
  await atomicWriteJson(filePath, data);
}

export function isValidStickerId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function readLegacyStickerMap(pluginConfig: Record<string, unknown> | undefined): Record<string, string> {
  const raw = pluginConfig?.stickerMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[0] === "string" && typeof e[1] === "string",
    ),
  );
}

/** Merge legacy config stickerMap as new entries (meaning `legacy:<alias>`). Skips duplicate fileIds. */
export function mergeLegacyStickerMap(
  base: StickerLibraryFile,
  stickerMap: Record<string, string>,
): StickerLibraryFile {
  const existingIds = new Set(base.stickers.map((s) => s.id));
  const existingFileIds = new Set(base.stickers.map((s) => s.fileId));
  const next = { ...base, stickers: [...base.stickers] };
  for (const [alias, fileId] of Object.entries(stickerMap)) {
    if (!alias.trim() || !fileId.trim()) continue;
    if (existingFileIds.has(fileId)) continue;
    let id = alias.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || `legacy_${randomUUID().slice(0, 8)}`;
    if (!isValidStickerId(id)) {
      id = `legacy_${randomUUID().slice(0, 8)}`;
    }
    let candidate = id;
    let n = 0;
    while (existingIds.has(candidate)) {
      n += 1;
      candidate = `${id.slice(0, 50)}_${n}`;
    }
    existingIds.add(candidate);
    existingFileIds.add(fileId);
    next.stickers.push({
      id: candidate,
      fileId,
      meaning: `legacy:${alias}`,
      createdAt: new Date().toISOString(),
    });
  }
  return next;
}

export type PluginStickerConfig = {
  maxCatalogLines?: number;
  enableStickerSearchHint?: boolean;
  migrateLegacyStickerMap?: boolean;
  stickerMap?: Record<string, string>;
  /** When true, tool may pass `to` only if it equals the current session chat (same string as deliveryContext.to). */
  allowExplicitChatId?: boolean;
  /** Optional override bot token for sendSticker (otherwise use channels.telegram from runtime config). */
  botTokenOverride?: string;
  /**
   * How to surface sticker policy to the model.
   * - `prepend_reminder` (default): add a short per-turn prependContext nudge so the model actually considers tg_sticker_send.
   * - `system_only`: only appendSystemContext (older behavior; models may ignore long policy blocks).
   */
  stickerPromptNudge?: "prepend_reminder" | "system_only";
  /**
   * Telegram Bot API sendSticker body: `json` (default) or `form` (x-www-form-urlencoded, same as curl `-d`).
   */
  sendStickerBodyEncoding?: "json" | "form";
};

export function readPluginStickerConfig(pluginConfig: Record<string, unknown> | undefined): PluginStickerConfig {
  if (!pluginConfig) {
    return {};
  }
  const maxCatalogLines =
    typeof pluginConfig.maxCatalogLines === "number" && pluginConfig.maxCatalogLines > 0
      ? Math.min(500, Math.floor(pluginConfig.maxCatalogLines))
      : 40;
  const enableStickerSearchHint = pluginConfig.enableStickerSearchHint !== false;
  const migrateLegacyStickerMap = pluginConfig.migrateLegacyStickerMap === true;
  const stickerMap = readLegacyStickerMap(pluginConfig);
  const allowExplicitChatId = pluginConfig.allowExplicitChatId === true;
  const botTokenOverride =
    typeof pluginConfig.botTokenOverride === "string" && pluginConfig.botTokenOverride.trim()
      ? pluginConfig.botTokenOverride.trim()
      : undefined;
  const stickerPromptNudge =
    pluginConfig.stickerPromptNudge === "system_only" ? "system_only" : "prepend_reminder";
  const sendStickerBodyEncoding =
    pluginConfig.sendStickerBodyEncoding === "form" ? "form" : "json";
  return {
    maxCatalogLines,
    enableStickerSearchHint,
    migrateLegacyStickerMap,
    stickerMap,
    allowExplicitChatId,
    botTokenOverride,
    stickerPromptNudge,
    sendStickerBodyEncoding,
  };
}

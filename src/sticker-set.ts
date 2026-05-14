/**
 * Parse a public sticker set name from `https://t.me/addstickers/<name>` or a plain set name.
 * Telegram set names are typically [a-zA-Z0-9_]+.
 */
export function parseStickerSetName(input: string): string | undefined {
  const s = input.trim();
  if (!s) {
    return undefined;
  }
  const fromUrl = s.match(/(?:https?:\/\/)?t\.me\/addstickers\/([a-zA-Z0-9_]+)\/?$/i);
  if (fromUrl?.[1]) {
    return fromUrl[1];
  }
  if (/^[a-zA-Z0-9_]{1,64}$/.test(s)) {
    return s;
  }
  return undefined;
}

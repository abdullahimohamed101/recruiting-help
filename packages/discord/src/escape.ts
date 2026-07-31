export function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return !(
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      );
    })
    .join("");
}

export function escapeDiscordMarkdown(value: string): string {
  return stripControlCharacters(value).replace(/([\\`*_~|:>[\]()])/gu, "\\$1");
}

export function truncateDiscordText(value: string, maxLength: number): string {
  const cleaned = stripControlCharacters(value).trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  if (maxLength <= 1) {
    return cleaned.slice(0, maxLength);
  }
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

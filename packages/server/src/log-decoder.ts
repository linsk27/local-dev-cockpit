import { TextDecoder } from "node:util";

const legacyWindowsDecoder = new TextDecoder("gb18030", { fatal: false });
const replacementCharacter = "\uFFFD";

/**
 * Child process output on Windows is not always UTF-8. Node-based tools usually
 * emit UTF-8, while cmd.exe and some package manager wrappers can still emit
 * bytes in the active Chinese code page. Prefer UTF-8, then fall back to
 * GB18030 only when UTF-8 produced replacement characters.
 */
export function decodeProcessChunk(chunk: Buffer): string {
  const utf8 = chunk.toString("utf8");
  if (!utf8.includes(replacementCharacter)) return utf8;

  const legacy = legacyWindowsDecoder.decode(chunk);
  return countReplacementCharacters(legacy) < countReplacementCharacters(utf8) ? legacy : utf8;
}

function countReplacementCharacters(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === replacementCharacter) count += 1;
  }
  return count;
}

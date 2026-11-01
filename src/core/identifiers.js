let fallbackSequence = 0;

/**
 * Create a UUID-shaped record identifier. These IDs are not credentials or
 * security tokens; the fallback only preserves application startup where Web
 * Crypto's randomUUID/getRandomValues APIs are unavailable.
 */
export function createUuid(cryptoSource = globalThis.crypto){
  if (typeof cryptoSource?.randomUUID === "function"){
    try {
      return cryptoSource.randomUUID();
    } catch {
      // Continue to other identifier sources if a partial implementation throws.
    }
  }

  const bytes = new Uint8Array(16);
  let filled = false;
  if (typeof cryptoSource?.getRandomValues === "function"){
    try {
      cryptoSource.getRandomValues(bytes);
      filled = true;
    } catch {
      // Use the non-security fallback for identifiers only.
    }
  }
  if (!filled){
    const salt = (Date.now() ^ Math.imul(++fallbackSequence, 0x9e3779b9)) >>> 0;
    for (let index = 0; index < bytes.length; index++){
      bytes[index] = (Math.floor(Math.random() * 256) ^ ((salt >>> ((index % 4) * 8)) & 0xff)) & 0xff;
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

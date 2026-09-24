// Display labels for stored codes. Records keep machine values such as
// "on_hold" or "used_midyear"; people should read "On hold" and "Used midyear".

/** "on_hold" → "On hold". Empty input stays empty. */
export function humanizeCode(value: string | undefined | null): string {
  if (!value) return "";
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

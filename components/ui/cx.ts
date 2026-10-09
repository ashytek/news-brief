/** Join class names, skipping falsy parts. (No clsx dependency for this.) */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

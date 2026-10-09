import { Fragment } from 'react'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Text with the words of `query` marked (accent-soft background, not colour
 *  alone: the mark is also semantic <mark>). No query: the text unchanged. */
export function Highlight({ text, query }: { text: string; query?: string }) {
  const words = (query ?? '').split(/\s+/).map(w => w.trim()).filter(w => w.length >= 2)
  if (words.length === 0) return <>{text}</>
  const re = new RegExp(`(${words.map(escape).join('|')})`, 'gi')
  const lower = words.map(w => w.toLowerCase())
  return (
    <>
      {text.split(re).map((part, i) =>
        lower.includes(part.toLowerCase())
          ? <mark key={i} className="rounded-[4px] bg-accent-soft px-0.5 text-fg-1">{part}</mark>
          : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  )
}

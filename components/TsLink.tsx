'use client'

interface Props {
  videoUrl: string
  timestampSeconds: number | null
  children: React.ReactNode
}

export function TsLink({ videoUrl, timestampSeconds, children }: Props) {
  const url = timestampSeconds
    ? `${videoUrl}${videoUrl.includes('?') ? '&' : '?'}t=${timestampSeconds}s`
    : videoUrl

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
    >
      {children}
    </a>
  )
}

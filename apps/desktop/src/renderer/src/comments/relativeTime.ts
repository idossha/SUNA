/**
 * Coarse relative-time label for comment/reply timestamps ("3m ago",
 * "2d ago"). Pure and side-effect free — `now` is a parameter so it's
 * trivially testable without mocking the system clock.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`

  const diffMonth = Math.round(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo ago`

  const diffYear = Math.round(diffMonth / 12)
  return `${diffYear}y ago`
}

// "Just now", "5m ago", "3h ago", "2d ago"
export const formatTimestamp = (ts: number): string => {
  const diffMins = Math.floor((Date.now() - ts) / (1000 * 60))
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export const urlFormatter = (_: unknown, __: unknown, url = '') => decodeURIComponent(url)

export const timeFormatter = (_: unknown, __: unknown, time?: string) => {
  if (!time)
    return ''
  return new Date(time).toLocaleString()
}

export const refreshTimeFormatter = (_: unknown, __: unknown, time = 0) => {
  if (!time)
    return 'Never'
  if (time < 0) {
    return ({
      [-1]: 'Next day at 04:00',
      [-2]: 'Manual',
      [-3]: 'Next day at 00:00',
    } as Record<number, string>)[time]
  }
  const labels: string[] = []
  const days = Math.floor(time / 86_400_000)
  days > 0 && labels.push(`${days}d`)
  const hours = Math.floor(time % 86_400_000 / 3_600_000)
  hours > 0 && labels.push(`${hours}h`)
  const mins = Math.floor(time % 3600 / 60_000)
  mins > 0 && labels.push(`${mins}m`)
  return labels.join(' ')
}

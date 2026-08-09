export function localDateIso(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isWorkspaceDueDateOverdue(
  dueDate: string | null | undefined,
  today = localDateIso()
): boolean {
  return Boolean(dueDate && dueDate < today)
}

export function formatWorkspaceDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) {
    return '—'
  }
  const parsed = new Date(`${dueDate}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? dueDate : parsed.toLocaleDateString()
}

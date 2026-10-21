// The footer's copyright year follows the calendar rather than going stale.
export function initFooter(): void {
  const year = String(new Date().getFullYear())
  document.querySelectorAll<HTMLElement>('[data-year]').forEach((el) => {
    el.textContent = year
  })
}

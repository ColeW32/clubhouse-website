import './style.css'
import { startTicker } from './ticker'
import { initTornWindows } from './torn'

// Where the form goes. With an endpoint set (Formspree, a backend route,
// anything that accepts JSON POST) the page submits in place and reports
// back. Without one it falls back to composing an email in the visitor's
// own mail app — no infrastructure, nothing pretending to have sent.
const FORM_ENDPOINT = ''
const CONTACT_EMAIL = 'team@clubhousemedia.com' // PLACEHOLDER — set the real address

initTornWindows()
startTicker()

const form = document.getElementById('contact-form') as HTMLFormElement | null

const emailLooksReal = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)

if (form) {
  const statusEl = form.querySelector<HTMLElement>('[data-status]')!
  const submitBtn = form.querySelector<HTMLButtonElement>('.card__submit')!

  const setStatus = (text: string, kind: 'ok' | 'bad' | ''): void => {
    statusEl.textContent = text
    statusEl.classList.toggle('card__status--ok', kind === 'ok')
    statusEl.classList.toggle('card__status--bad', kind === 'bad')
  }

  const fieldValue = (name: string): string =>
    (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() ?? ''

  const validate = (): boolean => {
    const bad: Array<HTMLInputElement | HTMLTextAreaElement> = []
    form.querySelectorAll<HTMLElement>('[data-field]').forEach((wrap) => {
      const input = wrap.querySelector<HTMLInputElement | HTMLTextAreaElement>('.field__input')
      const error = wrap.querySelector<HTMLElement>('[data-error]')
      if (!input || !error) return
      const v = input.value.trim()
      let isBad = false
      if (input.required && v === '') isBad = true
      if (!isBad && input.id === 'cf-email' && v !== '' && !emailLooksReal(v)) isBad = true
      wrap.classList.toggle('field--bad', isBad)
      error.hidden = !isBad
      if (isBad) bad.push(input)
    })
    bad[0]?.focus()
    return bad.length === 0
  }

  // Errors clear as soon as the visitor starts fixing them.
  form.addEventListener('input', (e) => {
    const wrap = (e.target as HTMLElement).closest<HTMLElement>('[data-field]')
    if (wrap?.classList.contains('field--bad')) {
      wrap.classList.remove('field--bad')
      const error = wrap.querySelector<HTMLElement>('[data-error]')
      if (error) error.hidden = true
    }
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    setStatus('', '')
    if (fieldValue('website') !== '') return // honeypot tripped: drop it silently
    if (!validate()) return

    const name = fieldValue('name')
    const email = fieldValue('email')
    const company = fieldValue('company')
    const message = fieldValue('message')

    if (FORM_ENDPOINT) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Sending…'
      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, email, company, message }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status))
          form.reset()
          setStatus('Thanks — your message is in. We’ll get back to you soon.', 'ok')
        })
        .catch(() => {
          setStatus(`Something went wrong. Email us directly at ${CONTACT_EMAIL}.`, 'bad')
        })
        .finally(() => {
          submitBtn.disabled = false
          submitBtn.textContent = 'Send message'
        })
      return
    }

    // No endpoint: hand the message to the visitor's own mail app, fully
    // written, so nothing here claims to have sent anything it hasn't.
    const subject = `Hello from ${name}${company ? ` (${company})` : ''}`
    const body = `${message}\n\n— ${name}\n${email}${company ? `\n${company}` : ''}`
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    setStatus(`Opening your mail app — if nothing happens, write to ${CONTACT_EMAIL}.`, 'ok')
  })
}

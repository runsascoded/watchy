export interface PushoverEnv {
  PUSHOVER_TOKEN?: string
  PUSHOVER_USER?: string
}

/** No-op (returns false) when Pushover secrets aren't configured. */
export async function sendPushover(
  env: PushoverEnv,
  opts: { title: string; message: string; url?: string; priority?: number },
): Promise<boolean> {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return false
  const body = new URLSearchParams({
    token: env.PUSHOVER_TOKEN,
    user: env.PUSHOVER_USER,
    title: opts.title,
    message: opts.message,
  })
  if (opts.url) body.set('url', opts.url)
  if (opts.priority !== undefined) body.set('priority', String(opts.priority))

  const resp = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    throw new Error(`Pushover ${resp.status}: ${await resp.text()}`)
  }
  return true
}

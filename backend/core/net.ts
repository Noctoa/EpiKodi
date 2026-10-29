/**
 * Les quelques précautions que prend toute requête sortante de l'application : un délai au bout
 * duquel on abandonne, un agent qui nous identifie, et une erreur dès que le serveur répond
 * autre chose qu'un succès. Un `fetch` nu n'a pas de délai d'expiration : une requête vers un
 * serveur qui ne répond jamais resterait en attente indéfiniment.
 */
const DEFAULT_TIMEOUT_MS = 20_000
export const USER_AGENT = 'EpiKodi/0.1 (+https://github.com/Noctoa/EpiKodi)'

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Un appelant peut déjà vouloir annuler de son côté (téléchargement interrompu) : les deux
  // signaux comptent, le premier qui part gagne.
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal,
      headers: { 'User-Agent': USER_AGENT, ...init.headers }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

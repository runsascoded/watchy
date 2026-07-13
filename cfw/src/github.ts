/** Minimal GitHub REST client: token auth, Link-header pagination. */

const API = 'https://api.github.com'
const PER_PAGE = 100
const MAX_PAGES = 100

export interface Repo {
  full_name: string
  stargazers_count: number
}

export interface Stargazer {
  starred_at: string | null
  uid: number
  login: string
}

export interface Follower {
  uid: number
  login: string
}

export class GhError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`GitHub ${status}: ${url}`)
  }
}

async function* paginate(token: string, path: string, accept?: string): AsyncGenerator<any> {
  let url: string | null = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}`
  let pages = 0
  while (url && pages++ < MAX_PAGES) {
    const resp: Response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: accept ?? 'application/vnd.github.v3+json',
        'user-agent': 'watchy-cfw',
      },
    })
    if (!resp.ok) throw new GhError(resp.status, url)
    const items = (await resp.json()) as any[]
    yield* items
    url = null
    const link = resp.headers.get('link')
    if (link) {
      for (const part of link.split(',')) {
        if (part.includes('rel="next"')) {
          url = part.split(';')[0].trim().replace(/^<|>$/g, '')
          break
        }
      }
    }
  }
}

/** Public repos owned by a user/org (matches the py client: /users/{owner}/repos?type=owner). */
export async function listRepos(token: string, owner: string): Promise<Repo[]> {
  const repos: Repo[] = []
  for await (const r of paginate(token, `/users/${owner}/repos?type=owner`)) {
    if (r.private) continue
    repos.push({ full_name: r.full_name, stargazers_count: r.stargazers_count })
  }
  return repos
}

/** star+json accept variant → each entry carries `starred_at`. */
export async function listStargazers(token: string, repo: string): Promise<Stargazer[]> {
  const out: Stargazer[] = []
  for await (const s of paginate(token, `/repos/${repo}/stargazers`, 'application/vnd.github.star+json')) {
    out.push({ starred_at: s.starred_at ?? null, uid: s.user.id, login: s.user.login })
  }
  return out
}

export async function listFollowers(token: string, user: string): Promise<Follower[]> {
  const out: Follower[] = []
  for await (const f of paginate(token, `/users/${user}/followers`)) {
    out.push({ uid: f.id, login: f.login })
  }
  return out
}

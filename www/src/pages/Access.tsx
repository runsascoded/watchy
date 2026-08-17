import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tooltip } from '../components/Tooltip'
import { ApiError, get, post } from '../api'
import { SignInPanel, useWhoami } from '../auth'

// Shapes come from `@open-athena/auth`: string ids, epoch-second timestamps,
// `name` (was `label`), and `redeems` — *sessions minted*, not requests served
// (specs/auth-adoption.md).
import type { Grant } from '@open-athena/auth'

interface Minted {
  grant: Grant
  token: string
}

const day = (s: number | null) => (s == null ? '—' : new Date(s * 1000).toISOString().slice(0, 10))
const minute = (s: number | null) => (s == null ? '—' : new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z')

const linkFor = (token: string) => `${location.origin}/actors?key=${token}`

function status(g: Grant): string {
  if (g.revokedAt) return 'revoked'
  if (g.expiresAt && g.expiresAt * 1000 < Date.now()) return 'expired'
  if (g.maxRedeems != null && g.redeems >= g.maxRedeems) return 'exhausted'
  return 'active'
}

/** Admin CRUD for access grants (share links / magic links). */
export default function Access() {
  const { whoami } = useWhoami()
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')
  const [ttl, setTtl] = useState('')
  const [minted, setMinted] = useState<Minted | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['grants'],
    // `all=1` keeps revoked grants in the table (dimmed, per status() below) — the
    // package hides them by default, but a revoked link is exactly what you want to
    // see when someone asks "did you turn that off?"
    queryFn: () => get<{ grants: Grant[] }>('/api/auth/grants?all=1'),
    enabled: whoami?.admin === true,
    retry: false,
  })
  const mint = useMutation({
    mutationFn: () =>
      post<Minted>('/api/auth/grants', {
        name: label.trim(),
        scopes: ['internal'],
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(ttl.trim() ? { expiresInS: parseInt(ttl, 10) * 86_400 } : {}),
      }),
    onSuccess: m => {
      setMinted(m)
      setLabel(''); setEmail(''); setTtl('')
      qc.invalidateQueries({ queryKey: ['grants'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => post(`/api/auth/grants/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grants'] }),
  })

  if (whoami === undefined) return <p className="dim">loading…</p>
  if (whoami === null) return <SignInPanel next="/access" />
  if (!whoami.admin) return <p className="error">Admin only ({whoami.email ?? 'this link'} is not an admin).</p>
  if (isLoading) return <p className="dim">loading…</p>
  if (error) return <p className="error">{error instanceof ApiError ? `error ${error.status}` : String(error)}</p>

  return (
    <div className="access">
      <p>
        Access grants: nonced links that sign a browser into the restricted sections.
        A grant with an email attached is a <b>magic link</b> for that person; tokens are shown once, at mint.
      </p>
      <form
        className="mint"
        onSubmit={e => { e.preventDefault(); if (label.trim()) mint.mutate() }}
      >
        <input placeholder="label (required — who/what is this for?)" value={label} onChange={e => setLabel(e.target.value)} />
        <input placeholder="email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="TTL days (optional)" value={ttl} onChange={e => setTtl(e.target.value)} size={10} />
        <button type="submit" disabled={!label.trim() || mint.isPending}>mint</button>
        {mint.error && <span className="error">{String(mint.error)}</span>}
      </form>
      {minted && (
        <div className="minted">
          <b>{minted.grant.name}</b> — copy this link now; it won't be shown again:
          <div className="token-row">
            <code>{linkFor(minted.token)}</code>
            <button onClick={() => navigator.clipboard.writeText(linkFor(minted.token))}>copy</button>
            {minted.grant.email && (
              <a
                className="btn"
                href={`mailto:${minted.grant.email}?subject=${encodeURIComponent('watchy access link')}&body=${encodeURIComponent(`Here's your access link for gh.oa.dev:\n\n${linkFor(minted.token)}\n\nOpening it signs your browser in automatically.`)}`}
              >
                email it
              </a>
            )}
            <button onClick={() => setMinted(null)}>dismiss</button>
          </div>
        </div>
      )}
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>label</th><th>email</th><th>scopes</th><th>created</th><th>expires</th>
              <th className="num">redeems</th><th>last used</th><th>status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.grants ?? []).map(g => (
              <tr key={g.id} className={status(g) === 'active' ? '' : 'dim'}>
                <td><b>{g.name}</b></td>
                <td>{g.email}</td>
                <td>{g.scopes.join(' ')}</td>
                <td><Tooltip tip={`by ${g.createdBy}`}><span>{day(g.createdAt)}</span></Tooltip></td>
                <td>{day(g.expiresAt)}</td>
                <td className="num">{g.redeems}{g.maxRedeems != null ? ` / ${g.maxRedeems}` : ''}</td>
                <td>{minute(g.lastUsedAt)}</td>
                <td>{status(g)}</td>
                <td>
                  {status(g) === 'active' && (confirming === g.id ? (
                    <>
                      <button className="danger" onClick={() => { revoke.mutate(g.id); setConfirming(null) }}>confirm revoke</button>
                      <button onClick={() => setConfirming(null)}>keep</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(g.id)}>revoke</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tooltip } from '../components/Tooltip'
import { ApiError, get, post } from '../api'
import { SignInPanel, useWhoami } from '../auth'

interface GrantRow {
  id: number
  label: string
  email: string | null
  scopes: string
  created_by: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  use_count: number
}

interface Minted {
  id: number
  token: string
  label: string
  email: string | null
  expires_at: string | null
}

const linkFor = (token: string) => `${location.origin}/actors?key=${token}`

function status(g: GrantRow): string {
  if (g.revoked_at) return 'revoked'
  if (g.expires_at && g.expires_at < new Date().toISOString()) return 'expired'
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
  const [confirming, setConfirming] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['grants'],
    queryFn: () => get<{ grants: GrantRow[] }>('/api/auth/grants'),
    enabled: whoami?.admin === true,
    retry: false,
  })
  const mint = useMutation({
    mutationFn: () =>
      post<Minted>('/api/auth/grants', {
        label: label.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(ttl.trim() ? { ttl_days: parseInt(ttl, 10) } : {}),
      }),
    onSuccess: m => {
      setMinted(m)
      setLabel(''); setEmail(''); setTtl('')
      qc.invalidateQueries({ queryKey: ['grants'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: number) => post(`/api/auth/grants?id=${id}`, undefined, 'DELETE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grants'] }),
  })

  if (whoami === undefined) return <p className="dim">loading…</p>
  if (whoami === null) return <SignInPanel next="/access" />
  if (!whoami.admin) return <p className="error">Admin only ({whoami.email ?? whoami.label} is not an admin).</p>
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
          <b>{minted.label}</b> — copy this link now; it won't be shown again:
          <div className="token-row">
            <code>{linkFor(minted.token)}</code>
            <button onClick={() => navigator.clipboard.writeText(linkFor(minted.token))}>copy</button>
            {minted.email && (
              <a
                className="btn"
                href={`mailto:${minted.email}?subject=${encodeURIComponent('watchy access link')}&body=${encodeURIComponent(`Here's your access link for watchy.oa.dev:\n\n${linkFor(minted.token)}\n\nOpening it signs your browser in automatically.`)}`}
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
              <th className="num">uses</th><th>last used</th><th>status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.grants ?? []).map(g => (
              <tr key={g.id} className={status(g) === 'active' ? '' : 'dim'}>
                <td><b>{g.label}</b></td>
                <td>{g.email}</td>
                <td>{g.scopes}</td>
                <td><Tooltip tip={`by ${g.created_by}`}><span>{g.created_at.slice(0, 10)}</span></Tooltip></td>
                <td>{g.expires_at?.slice(0, 10) ?? '—'}</td>
                <td className="num">{g.use_count}</td>
                <td>{g.last_used_at ? g.last_used_at.slice(0, 16).replace('T', ' ') + 'Z' : '—'}</td>
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

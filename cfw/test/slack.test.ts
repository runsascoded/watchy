// Mirror of test/test_slack.py's render cases — expected strings must stay byte-identical
// across renderEvent (here) and render_event (src/watchy/slack.py). CI runs both.
import { describe, expect, it } from 'vitest'
import { iconUrl, renderActorOp, renderEvent, type ActorBits } from '../src/slack'

const ev = (id: number, ts: string, kind: string, target: string, login: string) => ({ id, ts, kind, target, login })

describe('renderEvent', () => {
  it('renders each kind without leading emoji', () => {
    expect(renderEvent(ev(1, '2026-07-28T16:01:43Z', 'star', 'Open-Athena/Kelp', 'postylem'))).toBe(
      '<https://github.com/postylem|postylem> starred <https://github.com/Open-Athena/Kelp|Kelp> · 2026-07-28 16:01Z',
    )
    expect(renderEvent(ev(2, '2026-07-13T02:18:21Z', 'unstar', 'ryan-williams/git-helpers', 'zhangkejiang'))).toBe(
      '<https://github.com/zhangkejiang|zhangkejiang> unstarred <https://github.com/ryan-williams/git-helpers|git-helpers> · 2026-07-13 02:18Z',
    )
    expect(renderEvent(ev(3, '2026-07-24T01:00:28Z', 'follow', 'ryan-williams', 'chrisipanaque'))).toBe(
      '<https://github.com/chrisipanaque|chrisipanaque> followed <https://github.com/ryan-williams|ryan-williams> · 2026-07-24 01:00Z',
    )
    expect(renderEvent(ev(4, '2026-07-20T22:00:00Z', 'unfollow', 'Open-Athena', 'electricmoss'))).toBe(
      '<https://github.com/electricmoss|electricmoss> unfollowed <https://github.com/Open-Athena|Open-Athena> · 2026-07-20 22:00Z',
    )
  })

  it('appends running totals (thousands-separated; :star: repos, :mega: orgs)', () => {
    expect(renderEvent(ev(1, '2026-08-04T22:30:40Z', 'star', 'marin-community/marin', 'XILDLX'), 1237)).toBe(
      '<https://github.com/XILDLX|XILDLX> starred <https://github.com/marin-community/marin|marin> · 2026-08-04 22:30Z · 1,237 :star:',
    )
    expect(renderEvent(ev(3, '2026-08-04T12:30:33Z', 'follow', 'marin-community', 'michaelmuchane'), 89)).toBe(
      '<https://github.com/michaelmuchane|michaelmuchane> followed <https://github.com/marin-community|marin-community> · 2026-08-04 12:30Z · 89 :mega:',
    )
  })

  it('mentions mapped Slack users after the GH link', () => {
    expect(renderEvent(ev(5, '2026-08-06T12:00:00Z', 'star', 'Open-Athena/Kelp', 'ryan-williams'), 13, 'U0922LQRRM0')).toBe(
      '<https://github.com/ryan-williams|ryan-williams> (<@U0922LQRRM0>) starred <https://github.com/Open-Athena/Kelp|Kelp> · 2026-08-06 12:00Z · 13 :star:',
    )
  })

  it('prefixes a workspace org emoji outside the repo link when configured', () => {
    expect(renderEvent(ev(1, '2026-08-04T22:30:40Z', 'star', 'marin-community/marin', 'XILDLX'), 1237, undefined, undefined, 'marin-community')).toBe(
      '<https://github.com/XILDLX|XILDLX> starred :marin-community: <https://github.com/marin-community/marin|marin> · 2026-08-04 22:30Z · 1,237 :star:',
    )
  })

  it('links the running total to the dashboard feed filtered on the target', () => {
    expect(renderEvent(ev(1, '2026-08-04T22:30:40Z', 'star', 'marin-community/marin', 'XILDLX'), 1237, undefined, 'https://watchy.oa.dev')).toBe(
      '<https://github.com/XILDLX|XILDLX> starred <https://github.com/marin-community/marin|marin> · 2026-08-04 22:30Z · <https://watchy.oa.dev/?t=marin-community%2Fmarin|1,237 :star:>',
    )
  })
})

describe('renderActorOp', () => {
  const bits = (over: Partial<ActorBits>): ActorBits => ({
    login: 'x', name: null, company: null, location: null, bio: null, blog: null, twitter: null,
    followers: null, public_repos: null, star_sum: null, gh_created_at: null, orgs: null,
    bsky_handle: null, bsky_followers: null, research: null, ...over,
  })
  const nn = bits({
    login: 'nnagarajan', name: 'Naveen Nagarajan', followers: 6, public_repos: 79, star_sum: 3,
    gh_created_at: '2014-08-25T03:38:06Z', bsky_handle: 'nnagarajan.bsky.social', bsky_followers: 12,
  })
  const e = ev(3095, '2026-08-10T22:46:20Z', 'star', 'marin-community/marin', 'nnagarajan')

  it('rides the event on the sender line and stacks the actor bits in the body', () => {
    const msg = renderActorOp(e, nn, 1253, undefined, 'https://watchy.oa.dev')
    expect(msg.username).toBe("Naveen Nagarajan ⭐'d marin — 8/10 22:46Z")
    expect(msg.icon_url).toBe('https://github.com/nnagarajan.png?size=96')
    expect(msg.text.split('\n')).toEqual([
      '<https://github.com/nnagarajan|nnagarajan> · 6 followers · 79 repos (3 :star:) · joined 2014'
        + ' · :bsky: <https://bsky.app/profile/nnagarajan.bsky.social|12>'
        + ' · :linkedin: <https://www.linkedin.com/search/results/people/?keywords=Naveen%20Nagarajan|search>',
      '<https://github.com/marin-community/marin|marin> · <https://watchy.oa.dev/?t=marin-community%2Fmarin|1,253 :star:>',
    ])
  })

  it('low-info actors get just the event-ref line, login-voiced', () => {
    const anon = bits({ login: 'mearcstapa-gqz', followers: 1 })
    const msg = renderActorOp(ev(9, '2026-08-10T16:20:00Z', 'follow', 'marin-community', 'mearcstapa-gqz'), anon, 130)
    expect(msg.username).toBe('mearcstapa-gqz 📣 followed marin-community — 8/10 16:20Z')
    expect(msg.text.split('\n')).toEqual([
      '<https://github.com/marin-community|marin-community> · 130 :mega:',
    ])
  })

  it('bio, orgs, blog, and research stack between the stats and event-ref lines', () => {
    const a = bits({
      login: 'chiphuyen', name: 'Chip Huyen', location: 'San Francisco', bio: 'ML sys',
      blog: 'huyenchip.com', twitter: 'chipro', followers: 23923, public_repos: 30,
      gh_created_at: '2015-03-01T00:00:00Z', orgs: '["a","b"]', research: 'Author of Designing ML Systems.',
    })
    const msg = renderActorOp(ev(1, '2024-04-28T01:00:00Z', 'star', 'marin-community/levanter', 'chiphuyen'), a)
    expect(msg.username).toBe("Chip Huyen ⭐'d levanter — 4/28 01:00Z")
    expect(msg.text.split('\n')).toEqual([
      '<https://github.com/chiphuyen|chiphuyen> · 23,923 followers · 30 repos · joined 2015'
        + ' · 𝕏 <https://x.com/chipro|@chipro>'
        + ' · :linkedin: <https://www.linkedin.com/search/results/people/?keywords=Chip%20Huyen|search>',
      'San Francisco',
      '_ML sys_',
      'orgs: a, b',
      ':globe_with_meridians: <https://huyenchip.com|huyenchip.com>',
      ':mag: Author of Designing ML Systems.',
      '<https://github.com/marin-community/levanter|levanter>',
    ])
  })
})

describe('iconUrl', () => {
  it('keys the slug off the target org, lowercased', () => {
    expect(iconUrl('Open-Athena/Kelp', 'star')).toBe('https://watchy.rbw.sh/icons/open-athena-star.png?v=3')
    expect(iconUrl('marin-community', 'follow')).toBe('https://watchy.rbw.sh/icons/marin-community-follow.png?v=3')
  })
  it('falls back to gh for unknown orgs', () => {
    expect(iconUrl('runsascoded/watchy', 'unstar')).toBe('https://watchy.rbw.sh/icons/gh-unstar.png?v=3')
  })
})

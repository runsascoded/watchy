// Both site variants are branding/features-only now (specs/worker-split.md):
// each flavor's API serves only its own instance's targets, so no client-side
// scope filtering. The internal bundle (gh.oa.dev, VITE_INTERNAL=1) adds the
// authed routes; the public bundle (watchy.rbw.sh) omits them.
export const INTERNAL = import.meta.env.VITE_INTERNAL === '1'

export const owner = (target: string) => target.split('/')[0]

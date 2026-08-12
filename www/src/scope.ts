// Both site variants share one worker/API; scoping is a build-time concern:
// the internal bundle (gh.oa.dev, VITE_INTERNAL=1) shows only OA/marin
// targets, the public bundle (watchy.rbw.sh) only personal ones.
export const INTERNAL = import.meta.env.VITE_INTERNAL === '1'

export const OA_OWNERS = new Set(['Open-Athena', 'marin-community'])

export const owner = (target: string) => target.split('/')[0]
export const inScope = (target: string) => OA_OWNERS.has(owner(target)) === INTERNAL

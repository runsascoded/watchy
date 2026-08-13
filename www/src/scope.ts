// Compile-time feature bit: internal builds add the authed/admin surfaces
// (Actors, Access, WhoamiChip). Off in the public reference instance; forks
// that run the auth gate flip it on (see the `oa` branch).
export const INTERNAL = import.meta.env.VITE_INTERNAL === '1'

export const owner = (target: string) => target.split('/')[0]

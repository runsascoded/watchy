// Compile-time feature bit: this instance runs the auth gate, so the authed/
// admin surfaces (Actors, Access, WhoamiChip) are compiled in.
export const INTERNAL = true

export const owner = (target: string) => target.split('/')[0]

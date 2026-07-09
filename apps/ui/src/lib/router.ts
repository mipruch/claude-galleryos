/**
 * Pure decision logic for the router's `beforeEach` guard (see
 * `router/index.ts`), split out so it's testable without mounting routes or
 * components. This is a front-end-only login gate (PLAN.md "Priority 6") —
 * `auth` reflects `useAuthStore`'s locally-remembered state, not a server
 * session.
 */

export interface GuardTarget {
  name?: string | symbol | null
  // `Record<string, unknown>` rather than `{ admin?: boolean }` so a real
  // Vue Router `RouteMeta` (an open, augmentable interface) is assignable
  // here without a cast.
  meta: Record<string, unknown>
  fullPath: string
}

export interface GuardAuthState {
  isAuthenticated: boolean
  isAdmin: boolean
}

export type GuardResult = true | { name: string; query: Record<string, string> } | { path: string }

/**
 * Decides whether a navigation may proceed.
 *
 * Every route except `login` and the kiosk viewer (which gates itself with a
 * PIN pad instead) requires a logged-in user; `meta.admin` routes
 * additionally require an admin role.
 */
export function resolveGuard(to: GuardTarget, auth: GuardAuthState): GuardResult {
  const isPublic = to.name === 'login' || to.name === 'kiosk'
  if (!isPublic && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (!!to.meta.admin && !auth.isAdmin) {
    return { path: '/' }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { path: '/' }
  }
  return true
}

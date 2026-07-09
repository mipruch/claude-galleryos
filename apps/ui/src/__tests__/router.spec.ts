import { describe, expect, it } from 'vitest'
import { resolveGuard } from '@/lib/router'

const loggedOut = { isAuthenticated: false, isAdmin: false }
const staff = { isAuthenticated: true, isAdmin: false }
const admin = { isAuthenticated: true, isAdmin: true }

describe('resolveGuard', () => {
  it('sends an unauthenticated visitor to /login, remembering where they were headed', () => {
    const result = resolveGuard({ name: 'home', meta: {}, fullPath: '/rooms/abc' }, loggedOut)
    expect(result).toEqual({ name: 'login', query: { redirect: '/rooms/abc' } })
  })

  it('lets an unauthenticated visitor reach /login itself', () => {
    expect(resolveGuard({ name: 'login', meta: {}, fullPath: '/login' }, loggedOut)).toBe(true)
  })

  it('lets an unauthenticated visitor reach the kiosk viewer (its own PIN pad gates it)', () => {
    expect(resolveGuard({ name: 'kiosk', meta: {}, fullPath: '/kiosk/Main%20Hall' }, loggedOut)).toBe(true)
  })

  it('lets a logged-in non-admin reach ordinary routes', () => {
    expect(resolveGuard({ name: 'home', meta: {}, fullPath: '/' }, staff)).toBe(true)
  })

  it('bounces a logged-in non-admin away from admin routes', () => {
    const result = resolveGuard({ name: 'admin-users', meta: { admin: true }, fullPath: '/admin/users' }, staff)
    expect(result).toEqual({ path: '/' })
  })

  it('lets an admin reach admin routes', () => {
    const result = resolveGuard({ name: 'admin-users', meta: { admin: true }, fullPath: '/admin/users' }, admin)
    expect(result).toBe(true)
  })

  it('redirects an already-logged-in user away from /login', () => {
    expect(resolveGuard({ name: 'login', meta: {}, fullPath: '/login' }, staff)).toEqual({ path: '/' })
  })
})

/**
 * The backstop's two primitives: replacing one service method and restoring it,
 * and reading a service that a deployment may not mount.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { decorateMethod, optionalService } from '../src/backstop.ts'

/** A stand-in service whose method is its own, as a plain object literal's is. */
interface OwnMethodService {
  read(): string
  write(value: string): string
}

/** A stand-in service whose method lives on the prototype, as a class's does. */
class PrototypeMethodService {
  /** @returns the prototype's answer. */
  read(): string {
    return 'prototype'
  }
}

describe('backstop primitives', () => {
  it('replaces an own method and puts the original value back', () => {
    const service: OwnMethodService = { read: () => 'own', write: value => `wrote ${value}` }
    const restore = decorateMethod(service, 'read', () => () => 'wrapped')
    expect(service.read()).toBe('wrapped')
    restore()
    expect(service.read()).toBe('own')
  })

  it('removes the own property it added over a prototype method', () => {
    const service = new PrototypeMethodService()
    expect(Object.hasOwn(service, 'read')).toBe(false)
    const restore = decorateMethod(service, 'read', () => () => 'wrapped')
    expect(Object.hasOwn(service, 'read')).toBe(true)
    expect(service.read()).toBe('wrapped')
    restore()
    expect(Object.hasOwn(service, 'read')).toBe(false)
    expect(service.read()).toBe('prototype')
  })

  it('forwards every argument to the method it replaced', () => {
    const service: OwnMethodService = { read: () => 'own', write: value => `wrote ${value}` }
    const seen: string[] = []
    decorateMethod(service, 'write', original => (value: string) => {
      seen.push(value)
      return original.call(service, value)
    })
    expect(service.write('x')).toBe('wrote x')
    expect(seen).toEqual(['x'])
  })

  it('reports a provided service and reports nothing for one that is absent', async () => {
    const ctx = new Context()
    const provided: Pick<OwnMethodService, 'read'> = { read: () => 'provided' }
    ctx.provide('probe', provided)
    expect(optionalService(ctx, 'probe')).toBe(provided)
    expect(optionalService(ctx, 'fs')).toBeUndefined()
    await ctx.fiber.dispose()
    expect(optionalService(ctx, 'probe')).toBeUndefined()
  })
})

/**
 * The control object's Win32 failure paths.
 *
 * Every branch here is a call the kernel refuses: a token that will not open, a
 * SID that will not copy, an ACL that will not build, an object that will not be
 * created, and a wait that neither succeeds nor reports contention. They run
 * against an injected Koffi table rather than a real failure, because a real one
 * is neither reproducible nor observable. The success path and the kernel's real
 * exclusion are covered natively by `runtime.spec.ts` and `control-lock.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A pinned result: one value, or a sequence consumed in call order. */
type Pinned = number | readonly number[]

const DEFAULTS: Record<string, number> = {
  CreateSemaphoreW: 7,
  WaitForSingleObject: 0,
  ReleaseSemaphore: 1,
  CloseHandle: 1,
  GetCurrentProcess: -1,
  OpenProcessToken: 1,
  GetTokenInformation: 1,
  ConvertStringSidToSidW: 1,
  GetLengthSid: 12,
  CopySid: 1,
  LocalFree: 0,
  InitializeSecurityDescriptor: 1,
  InitializeAcl: 1,
  AddAccessAllowedAce: 1,
  SetSecurityDescriptorDacl: 1,
  GetLastError: 5,
}

interface FakeKoffi {
  module: object
  calls: Map<string, ReturnType<typeof vi.fn>>
  structNames: string[]
}

/** A fake native address the fake table returns for every pointer decode. */
const FAKE_POINTER = 0x1000
/** The size `GetTokenInformation` reports for a `TOKEN_USER` record. */
const TOKEN_USER_SIZE = 44

/** What one loaded module instance exposes back to the suite. */
interface ControlSemaphoreModule {
  acquireControlSemaphore: (name: string) => Promise<{ handle: number; release: () => void }>
  aclSizeFor: (lengths: readonly number[]) => number
}

interface FakeOptions {
  /** Per-function pinned results, overriding {@link DEFAULTS}. */
  results?: Record<string, Pinned>
  /** uint32 out-parameter values, consumed in decode order. */
  uint32Decodes?: readonly number[]
}

function fakeKoffi(options: FakeOptions = {}): FakeKoffi {
  const structNames: string[] = []
  const calls = new Map<string, ReturnType<typeof vi.fn>>()
  const uint32s = [...(options.uint32Decodes ?? [])]
  let uint32Index = 0
  const library = {
    func: (_signature: string, name: string): unknown => {
      const pinned = options.results?.[name] ?? DEFAULTS[name] ?? 1
      const sequence = typeof pinned === 'number' ? [pinned] : [...pinned]
      let index = 0
      const fn = vi.fn(() => sequence[Math.min(index++, sequence.length - 1)] as number)
      calls.set(name, fn)
      return fn
    },
  }
  return {
    calls,
    structNames,
    module: {
      load: () => library,
      pointer: (type: string) => ({ pointer: type }),
      struct: (name: string) => { structNames.push(name); return { struct: name, size: 24 } },
      alloc: (type: unknown, count: number) => ({ alloc: count, type }),
      encode: vi.fn(),
      decode: (_address: unknown, type: unknown) => (type === 'uint32'
        ? (uint32s[Math.min(uint32Index++, uint32s.length - 1)] ?? TOKEN_USER_SIZE)
        : FAKE_POINTER),
    },
  }
}

/**
 * Load a fresh copy of the module against an injected Koffi table.
 *
 * The module caches its table on first use, so every case needs its own module
 * instance; that also keeps the per-process struct name unique.
 * @param options - pinned Win32 results and uint32 decodes for this case.
 * @returns the module under test, the calls it made, and the struct names it registered.
 */
async function loadWith(options: FakeOptions = {}): Promise<{
  module: ControlSemaphoreModule
  calls: Map<string, ReturnType<typeof vi.fn>>
  structNames: string[]
}> {
  const fake = fakeKoffi(options)
  vi.doMock('koffi', () => ({ default: fake.module }))
  vi.resetModules()
  return { module: await import('../src/win32-control-semaphore.ts'), calls: fake.calls, structNames: fake.structNames }
}

beforeEach(() => {
  vi.doUnmock('koffi')
  vi.resetModules()
})

describe('the ACL the control object is created with', () => {
  it('sizes one access-allowed ACE per principal plus the ACL header', async () => {
    const { module } = await loadWith()
    // Two ACEs of a 12-byte SID: an 8-byte header, an 8-byte mask and SID
    // offset, and the SID rounded to a 4-byte boundary, over an 8-byte ACL header.
    expect(module.aclSizeFor([12, 12])).toBe(8 + 2 * (8 + 8 + 12))
    expect(module.aclSizeFor([])).toBe(8)
  })

  it('admits exactly the creating user and Local System', async () => {
    const { module, calls } = await loadWith()
    const held = await module.acquireControlSemaphore('Global\\dsh-webtest-control-aces')
    expect(held.handle).toBe(7)
    // Two SIDs are resolved: the process token's user, and the well-known Local
    // System SID. Nothing else is admitted to a machine-wide name.
    expect(calls.get('OpenProcessToken')).toHaveBeenCalledTimes(1)
    expect(calls.get('ConvertStringSidToSidW')).toHaveBeenCalledWith('S-1-5-18', expect.anything())
    expect(calls.get('AddAccessAllowedAce')).toHaveBeenCalledTimes(2)
    expect(calls.get('LocalFree')).toHaveBeenCalledTimes(1)
    expect(calls.get('CloseHandle')).toHaveBeenCalledWith(FAKE_POINTER)
    // The user SID's length is read from the PSID inside the TOKEN_USER record,
    // never from the record itself, and both SIDs are copied out of the memory
    // their lookups owned.
    expect(calls.get('CopySid')).toHaveBeenCalledTimes(2)
  })

  it('names the security attributes after a per-process struct', async () => {
    const { module, structNames } = await loadWith()
    await module.acquireControlSemaphore('Global\\dsh-webtest-control-struct')
    expect(structNames).toHaveLength(1)
    expect(structNames[0]).toMatch(/^DSH_WEBTEST_SECURITY_ATTRIBUTES_[0-9a-z]+$/u)
  })
})

describe('refused Win32 calls', () => {
  it('reports a token it cannot open, naming no subject', async () => {
    const { module } = await loadWith({ results: { OpenProcessToken: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-a'))
      .rejects.toThrow(/^control lock: OpenProcessToken failed with Win32 5$/u)
  })

  it('reports a token user record whose size it cannot learn', async () => {
    const { module } = await loadWith({ uint32Decodes: [0] })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-b'))
      .rejects.toThrow(/GetTokenInformation failed with Win32 5/u)
  })

  it('reports a token user record it cannot read', async () => {
    // The sizing call is expected to report a size; the reading call is not.
    const { module } = await loadWith({ results: { GetTokenInformation: [1, 0] } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-c'))
      .rejects.toThrow(/GetTokenInformation failed with Win32 5/u)
  })

  it('reports a SID it cannot copy', async () => {
    const { module } = await loadWith({ results: { CopySid: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-d'))
      .rejects.toThrow(/CopySid failed with Win32 5 \(process token\)/u)
  })

  it('reports a well-known SID it cannot resolve', async () => {
    const { module } = await loadWith({ results: { ConvertStringSidToSidW: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-e'))
      .rejects.toThrow(/ConvertStringSidToSidW failed with Win32 5 \(S-1-5-18\)/u)
  })

  it('reports an ACL it cannot initialize', async () => {
    const { module } = await loadWith({ results: { InitializeAcl: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-f'))
      .rejects.toThrow(/InitializeAcl failed with Win32 5/u)
  })

  it('reports an ACE it cannot append', async () => {
    const { module } = await loadWith({ results: { AddAccessAllowedAce: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-g'))
      .rejects.toThrow(/AddAccessAllowedAce failed with Win32 5/u)
  })

  it('reports a security descriptor it cannot initialize', async () => {
    const { module } = await loadWith({ results: { InitializeSecurityDescriptor: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-h'))
      .rejects.toThrow(/InitializeSecurityDescriptor failed with Win32 5/u)
  })

  it('reports a DACL it cannot attach', async () => {
    const { module } = await loadWith({ results: { SetSecurityDescriptorDacl: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-i'))
      .rejects.toThrow(/SetSecurityDescriptorDacl failed with Win32 5/u)
  })

  it('reports an object the kernel refuses to create', async () => {
    const { module } = await loadWith({ results: { CreateSemaphoreW: 0 } })
    await expect(module.acquireControlSemaphore('Global\\dsh-webtest-control-j'))
      .rejects.toThrow(/CreateSemaphoreW failed with Win32 5 \(Global\\dsh-webtest-control-j\)/u)
  })

  it('reports contention separately from a wait that simply failed', async () => {
    const held = await loadWith({ results: { WaitForSingleObject: 0x00000102 } })
    await expect(held.module.acquireControlSemaphore('Global\\dsh-webtest-control-k'))
      .rejects.toMatchObject({ win32Code: 32, syscall: 'WaitForSingleObject' })
    // WAIT_FAILED is neither acquisition nor contention, so the caller must see
    // the real error rather than a claim that someone else holds the root.
    const failed = await loadWith({ results: { WaitForSingleObject: 0xffffffff } })
    await expect(failed.module.acquireControlSemaphore('Global\\dsh-webtest-control-l'))
      .rejects.toMatchObject({ win32Code: 5, syscall: 'WaitForSingleObject' })
  })

  it('reports a release the kernel refuses', async () => {
    const { module } = await loadWith({ results: { ReleaseSemaphore: 0 } })
    const held = await module.acquireControlSemaphore('Global\\dsh-webtest-control-m')
    expect(() => { held.release() }).toThrow(/ReleaseSemaphore failed with Win32 5 \(Global\\dsh-webtest-control-m\)/u)
  })

  it('reports a close the kernel refuses', async () => {
    const { module } = await loadWith({ results: { CloseHandle: 0 } })
    const held = await module.acquireControlSemaphore('Global\\dsh-webtest-control-n')
    // The count was restored but the handle did not close, so the object would
    // outlive this writer; that is reported rather than ignored.
    expect(() => { held.release() }).toThrow(/ReleaseSemaphore failed with Win32 5/u)
  })
})

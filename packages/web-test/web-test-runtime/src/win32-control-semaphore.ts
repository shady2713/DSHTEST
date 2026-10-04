/**
 * The Windows kernel object that arbitrates one control root between processes.
 *
 * The object is a named semaphore with an initial and maximum count of 1 in the
 * `Global` namespace. `Global` is the session-independent namespace, so a second
 * launch under a different Windows login session contends for the same object
 * rather than silently opening a second write channel beside the first. A
 * semaphore rather than a mutex because mutex ownership is thread-affine — a
 * release would have to happen on the thread that acquired — while a semaphore's
 * count belongs to the object, so any thread and any `await` boundary can
 * release what this process acquired. The object is destroyed when its last
 * handle closes, including on any process death, so a crashed holder never
 * blocks a successor; a live but stalled holder keeps the object until it exits,
 * because there is deliberately no timeout that could expropriate a writer whose
 * resumed appends would interleave.
 *
 * Because the name lives in a machine-wide namespace, the object is created with
 * an explicit discretionary access control list admitting exactly two
 * principals: the creating user's token and Local System. Without it, a local
 * principal that could obtain the name could pre-create the object and refuse
 * the real writer access, denying service without ever touching the data root.
 *
 * The whole table is loaded lazily and cached, so a process that never takes the
 * lock never loads Koffi.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/win32-control-semaphore
 */

const SYSTEM_SID = 'S-1-5-18'
const TOKEN_QUERY = 0x0008
const TOKEN_USER_CLASS = 1
const ACL_REVISION = 2
const SECURITY_DESCRIPTOR_REVISION = 1
/**
 * Full access to a named semaphore: standard rights, synchronize, modify state,
 * and query state. A mutex would end at `0x1f0001`; a semaphore also needs
 * `SEMAPHORE_MODIFY_STATE`, which is the count this object exists to guard.
 */
const SEMAPHORE_ALL_ACCESS = 0x001f0003
/** `SECURITY_ATTRIBUTES` is a DWORD, a pointer, and a BOOL; x64 pads the DWORD to 8. */
const SECURITY_ATTRIBUTES_SIZE = 24
const SECURITY_DESCRIPTOR_SIZE = 64
const WAIT_OBJECT_0 = 0
const WAIT_TIMEOUT = 0x00000102
const ERROR_SHARING_VIOLATION = 32

type CreateSemaphoreW = (security: number, initial: number, maximum: number, name: string) => number
type WaitForSingleObject = (handle: number, milliseconds: number) => number
type ReleaseSemaphore = (handle: number, count: number, previous: null) => number
type CloseHandle = (handle: number) => number
type GetCurrentProcess = () => number
type OpenProcessToken = (process: number, access: number, token: number) => number
type GetTokenInformation = (
  token: number,
  cls: number,
  info: number | null,
  length: number,
  returned: number,
) => number
type ConvertStringSidToSidW = (stringSid: string, sid: number) => number
type GetLengthSid = (sid: number) => number
type CopySid = (length: number, destination: number, source: number) => number
type LocalFree = (memory: number) => number
type InitializeSecurityDescriptor = (descriptor: number, revision: number) => number
type InitializeAcl = (acl: number, length: number, revision: number) => number
type AddAccessAllowedAce = (acl: number, revision: number, access: number, sid: number) => number
type SetSecurityDescriptorDacl = (descriptor: number, present: number, acl: number, defaulted: number) => number
type GetLastError = () => number

/** A SID copied into memory this module owns, with its native address. */
interface OwnedSid {
  /** Native address of the copied SID. */
  readonly address: number
  /** The SID's own length in bytes. */
  readonly length: number
}

/** A failed Win32 call, carrying the operation and code the caller maps. */
export class Win32ControlError extends Error {
  /**
   * @param syscall - the failing Win32 operation.
   * @param win32Code - the captured `GetLastError` value, or the contention code the wait synthesized.
   * @param subject - the object or principal the call was about.
   */
  constructor(readonly syscall: string, readonly win32Code: number, readonly subject = '') {
    super(`control lock: ${syscall} failed with Win32 ${String(win32Code)}${subject === '' ? '' : ` (${subject})`}`)
    this.name = 'Win32ControlError'
  }
}

/** The code this module reports when another holder owns the control object. */
export const CONTROL_CONTENTION = ERROR_SHARING_VIOLATION

/** The kernel, security, and memory calls this module makes. */
export interface Win32ControlBindings {
  createSemaphoreW: CreateSemaphoreW
  waitForSingleObject: WaitForSingleObject
  releaseSemaphore: ReleaseSemaphore
  closeHandle: CloseHandle
  getCurrentProcess: GetCurrentProcess
  openProcessToken: OpenProcessToken
  getTokenInformation: GetTokenInformation
  convertStringSidToSidW: ConvertStringSidToSidW
  getLengthSid: GetLengthSid
  copySid: CopySid
  localFree: LocalFree
  initializeSecurityDescriptor: InitializeSecurityDescriptor
  initializeAcl: InitializeAcl
  addAccessAllowedAce: AddAccessAllowedAce
  setSecurityDescriptorDacl: SetSecurityDescriptorDacl
  getLastError: GetLastError
  /** Allocate `count` zeroed uint8 blocks of native memory. */
  allocUint8(count: number): number
  /** Allocate one pointer-sized slot. */
  allocVoidPointer(): number
  /** Read a uint32 out-parameter. */
  decodeUint32(slot: number): number
  /**
   * Read a native pointer stored at `address`, decoding a handle out-parameter
   * and the `PSID` field of a `TOKEN_USER` record the same way. Decoding both
   * as pointer-sized is what keeps a 64-bit handle from being truncated.
   */
  decodePointer(address: unknown): number
  /** Allocate a `SECURITY_ATTRIBUTES` record naming `descriptor`. */
  allocSecurityAttributes(descriptor: number): number
}

/** One acquired control semaphore and the table that owns its release. */
export interface HeldControlSemaphore {
  /** The open handle, recorded in the exclusion evidence. */
  readonly handle: number
  /** Restore the count and close the handle, so the object dies with the last one. */
  release(): void
}

let cached: Win32ControlBindings | undefined

/**
 * Load the Win32 table once per process.
 * @returns the cached kernel bindings.
 */
async function bindings(): Promise<Win32ControlBindings> {
  if (cached !== undefined) return cached
  const koffi = (await import('koffi')).default
  const kernel32 = koffi.load('kernel32.dll')
  const advapi32 = koffi.load('advapi32.dll')
  const bind = (
    library: ReturnType<typeof koffi.load>,
    name: string,
    result: string,
    args: string[],
  ): unknown => library.func('__stdcall', name, result, args)
  // The type name carries a per-process suffix because Koffi registers struct
  // types globally and refuses a second definition under one name.
  const securityAttributes = koffi.struct(`DSH_WEBTEST_SECURITY_ATTRIBUTES_${Math.random().toString(36).slice(2)}`, {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void*',
    bInheritHandle: 'int32',
  })
  cached = {
    createSemaphoreW: bind(kernel32, 'CreateSemaphoreW', 'intptr', ['void*', 'int', 'int', 'str16']) as CreateSemaphoreW,
    waitForSingleObject: bind(kernel32, 'WaitForSingleObject', 'uint', ['intptr', 'uint']) as WaitForSingleObject,
    releaseSemaphore: bind(kernel32, 'ReleaseSemaphore', 'int', ['intptr', 'int', 'void*']) as ReleaseSemaphore,
    closeHandle: bind(kernel32, 'CloseHandle', 'int', ['intptr']) as CloseHandle,
    getCurrentProcess: bind(kernel32, 'GetCurrentProcess', 'intptr', []) as GetCurrentProcess,
    openProcessToken: bind(advapi32, 'OpenProcessToken', 'int', ['intptr', 'uint32', 'void*']) as OpenProcessToken,
    getTokenInformation: bind(advapi32, 'GetTokenInformation', 'int', [
      'intptr', 'int', 'void*', 'uint32', 'void*',
    ]) as GetTokenInformation,
    convertStringSidToSidW: bind(advapi32, 'ConvertStringSidToSidW', 'int', ['str16', 'void*']) as ConvertStringSidToSidW,
    getLengthSid: bind(advapi32, 'GetLengthSid', 'uint32', ['void*']) as GetLengthSid,
    copySid: bind(advapi32, 'CopySid', 'int', ['uint32', 'void*', 'void*']) as CopySid,
    localFree: bind(kernel32, 'LocalFree', 'void*', ['void*']) as LocalFree,
    initializeSecurityDescriptor: bind(advapi32, 'InitializeSecurityDescriptor', 'int', ['void*', 'uint32']) as InitializeSecurityDescriptor,
    initializeAcl: bind(advapi32, 'InitializeAcl', 'int', ['void*', 'uint32', 'uint32']) as InitializeAcl,
    addAccessAllowedAce: bind(advapi32, 'AddAccessAllowedAce', 'int', ['void*', 'uint32', 'uint32', 'void*']) as AddAccessAllowedAce,
    setSecurityDescriptorDacl: bind(advapi32, 'SetSecurityDescriptorDacl', 'int', [
      'void*', 'int', 'void*', 'int',
    ]) as SetSecurityDescriptorDacl,
    getLastError: bind(kernel32, 'GetLastError', 'uint32', []) as GetLastError,
    allocUint8: count => koffi.alloc('uint8', count) as number,
    allocVoidPointer: () => koffi.alloc('void*', 1) as number,
    decodeUint32: slot => koffi.decode(slot, 'uint32') as number,
    decodePointer: address => koffi.decode(address, koffi.pointer('void')) as number,
    allocSecurityAttributes: (descriptor) => {
      const attributes = koffi.alloc(securityAttributes, 1) as number
      koffi.encode(attributes, securityAttributes, {
        nLength: SECURITY_ATTRIBUTES_SIZE,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
      })
      return attributes
    },
  }
  return cached
}

/**
 * Copy a SID into memory this module owns.
 *
 * The copy is what the DACL refers to: the source SID lives in a token buffer or
 * in `LocalAlloc` memory that is released before the object is created, and an
 * ACE pointing at freed memory would be an arbitrary access grant.
 * @param api - kernel bindings.
 * @param source - native address of the SID to copy.
 * @param subject - what the SID identifies, for the failure message.
 * @returns the copied SID's address and length.
 */
function ownSid(api: Win32ControlBindings, source: number, subject: string): OwnedSid {
  const length = api.getLengthSid(source)
  const address = api.allocUint8(length)
  if (api.copySid(length, address, source) === 0) {
    throw new Win32ControlError('CopySid', api.getLastError(), subject)
  }
  return { address, length }
}

/**
 * Resolve the creating user's SID out of its process token.
 * @param api - kernel bindings.
 * @returns the user's SID, copied into memory this module owns.
 */
function currentUserSid(api: Win32ControlBindings): OwnedSid {
  const tokenSlot = api.allocVoidPointer()
  if (api.openProcessToken(api.getCurrentProcess(), TOKEN_QUERY, tokenSlot) === 0) {
    throw new Win32ControlError('OpenProcessToken', api.getLastError())
  }
  const token = api.decodePointer(tokenSlot)
  try {
    const returnedSlot = api.allocVoidPointer()
    // The sizing call reports the required size through `returnedSlot`; the
    // call itself is expected to fail, so only a zero requirement is a failure.
    api.getTokenInformation(token, TOKEN_USER_CLASS, null, 0, returnedSlot)
    const needed = api.decodeUint32(returnedSlot)
    if (needed === 0) {
      throw new Win32ControlError('GetTokenInformation', api.getLastError())
    }
    const buffer = api.allocUint8(needed)
    if (api.getTokenInformation(token, TOKEN_USER_CLASS, buffer, needed, returnedSlot) === 0) {
      throw new Win32ControlError('GetTokenInformation', api.getLastError())
    }
    // TOKEN_USER is a SID_AND_ATTRIBUTES whose SID pointer is its first field,
    // so the record itself is not a SID: its length must come from the pointer.
    return ownSid(api, api.decodePointer(buffer), 'process token')
  } finally {
    api.closeHandle(token)
  }
}

/**
 * Resolve a well-known SID string into memory this module owns.
 * @param api - kernel bindings.
 * @param sidString - the SID's string form, for example `S-1-5-18`.
 * @returns the resolved SID, copied into memory this module owns.
 */
function wellKnownSid(api: Win32ControlBindings, sidString: string): OwnedSid {
  const sidSlot = api.allocVoidPointer()
  if (api.convertStringSidToSidW(sidString, sidSlot) === 0) {
    throw new Win32ControlError('ConvertStringSidToSidW', api.getLastError(), sidString)
  }
  const sid = api.decodePointer(sidSlot)
  try {
    return ownSid(api, sid, sidString)
  } finally {
    api.localFree(sid)
  }
}

/**
 * Size an ACL for exactly the access-allowed ACEs that will be appended.
 *
 * Each ACE is an 8-byte header, an 8-byte mask and SID offset, and the SID
 * itself rounded up to a 4-byte boundary; the ACL header is 8 bytes. Sizing
 * exactly is what lets one buffer hold the finished ACL, so the descriptor's
 * DACL pointer never dangles.
 * @param lengths - the byte length of each SID that will receive one ACE.
 * @returns the exact buffer size the ACL needs.
 */
export function aclSizeFor(lengths: readonly number[]): number {
  return lengths.reduce((total, length) => total + 8 + 8 + Math.ceil(length / 4) * 4, 8)
}

/**
 * Build the security descriptor the control object is created with: a
 * discretionary ACL admitting only the creating user and Local System.
 * @param api - kernel bindings.
 * @returns the native address of a `SECURITY_ATTRIBUTES` record.
 */
function securityAttributesFor(api: Win32ControlBindings): number {
  const principals = [currentUserSid(api), wellKnownSid(api, SYSTEM_SID)]
  const aclSize = aclSizeFor(principals.map(principal => principal.length))
  const acl = api.allocUint8(aclSize)
  if (api.initializeAcl(acl, aclSize, ACL_REVISION) === 0) {
    throw new Win32ControlError('InitializeAcl', api.getLastError())
  }
  for (const principal of principals) {
    if (api.addAccessAllowedAce(acl, ACL_REVISION, SEMAPHORE_ALL_ACCESS, principal.address) === 0) {
      throw new Win32ControlError('AddAccessAllowedAce', api.getLastError())
    }
  }
  const descriptor = api.allocUint8(SECURITY_DESCRIPTOR_SIZE)
  if (api.initializeSecurityDescriptor(descriptor, SECURITY_DESCRIPTOR_REVISION) === 0) {
    throw new Win32ControlError('InitializeSecurityDescriptor', api.getLastError())
  }
  if (api.setSecurityDescriptorDacl(descriptor, 1, acl, 0) === 0) {
    throw new Win32ControlError('SetSecurityDescriptorDacl', api.getLastError())
  }
  return api.allocSecurityAttributes(descriptor)
}

/**
 * Acquire one control root's write lock as a named kernel semaphore.
 *
 * The wait is zero-timeout by construction: this either owns the object now or
 * reports that another holder does. There is no retry loop and no expiry, so a
 * late acquirer can never take the object from a stalled holder.
 * @param name - full kernel object name from `controlLockName`.
 * @returns the acquired semaphore, whose `release` restores the count and closes the handle.
 * @throws when the object cannot be created or is currently owned by another holder.
 */
export async function acquireControlSemaphore(name: string): Promise<HeldControlSemaphore> {
  const api = await bindings()
  const attributes = securityAttributesFor(api)
  const handle = api.createSemaphoreW(attributes, 1, 1, name)
  if (handle === 0) {
    throw new Win32ControlError('CreateSemaphoreW', api.getLastError(), name)
  }
  const wait = api.waitForSingleObject(handle, 0)
  if (wait === WAIT_OBJECT_0) {
    return {
      handle,
      release: () => {
        const released = api.releaseSemaphore(handle, 1, null)
        const closed = api.closeHandle(handle)
        if (released === 0 || closed === 0) {
          throw new Win32ControlError('ReleaseSemaphore', api.getLastError(), name)
        }
      },
    }
  }
  // The handle is closed before reporting, so a refused acquirer never keeps the
  // object alive and later holders are never blocked by a lingering count.
  api.closeHandle(handle)
  if (wait === WAIT_TIMEOUT) {
    throw new Win32ControlError('WaitForSingleObject', ERROR_SHARING_VIOLATION, name)
  }
  throw new Win32ControlError('WaitForSingleObject', api.getLastError(), name)
}

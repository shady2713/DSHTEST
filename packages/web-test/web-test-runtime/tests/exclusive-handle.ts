/**
 * Hold a file open against deletion, so another process cannot replace it.
 *
 * The storage backend publishes a unit by renaming a temp file over its target,
 * which Windows refuses while a handle denies delete sharing. That makes this a
 * real medium fault rather than a simulated one: the bytes already on disk
 * survive untouched and the next publish fails the way a virus scanner, indexer,
 * or backup agent holding the file would make it fail. The suite uses it to
 * interrupt entry publication at a chosen commit boundary, so the handle must be
 * taken synchronously from inside the change event that fires at that boundary.
 */

import { createRequire } from 'node:module'

const requireKoffi = createRequire(import.meta.url)

type CreateFileW = (
  path: string,
  access: number,
  share: number,
  attributes: null,
  disposition: number,
  flags: number,
  template: null,
) => number
type CloseHandle = (handle: number) => number

/** The two kernel calls this helper makes. */
interface ExclusiveHandleBindings {
  createFileW: CreateFileW
  closeHandle: CloseHandle
}

const GENERIC_READ = 0x80000000
/**
 * Share mode denying delete while still allowing reads. The atomic publish is a
 * rename over the target, which needs delete access, so denying only that makes
 * the publish fail while the document stays readable — exactly the state a
 * scanner or backup agent holding the file produces.
 */
const FILE_SHARE_READ = 0x00000001
const OPEN_EXISTING = 3
const FILE_ATTRIBUTE_NORMAL = 0x00000080
const INVALID_HANDLE_VALUE = -1

let bindings: ExclusiveHandleBindings | undefined

function win32(): ExclusiveHandleBindings {
  if (bindings !== undefined) return bindings
  const koffi = requireKoffi('koffi') as {
    load(name: string): { func(signature: string, name: string, result: string, args: string[]): unknown }
  }
  const kernel32 = koffi.load('kernel32.dll')
  bindings = {
    createFileW: kernel32.func('__stdcall', 'CreateFileW', 'intptr', [
      'str16', 'uint32', 'uint32', 'void*', 'uint32', 'uint32', 'void*',
    ]) as CreateFileW,
    closeHandle: kernel32.func('__stdcall', 'CloseHandle', 'int', ['intptr']) as CloseHandle,
  }
  return bindings
}

/**
 * Open `path` denying delete sharing, so no rename can replace it while reads
 * still succeed.
 * @param path - absolute path of an existing file.
 * @returns the native handle, which the caller must pass to {@link closeExclusive}.
 * @throws when the file cannot be opened.
 */
export function openExclusive(path: string): number {
  const handle = win32().createFileW(path, GENERIC_READ, FILE_SHARE_READ, null, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, null)
  if (handle === 0 || handle === INVALID_HANDLE_VALUE) {
    throw new Error(`could not open '${path}' exclusively (handle ${String(handle)})`)
  }
  return handle
}

/**
 * Release a handle from {@link openExclusive}, which unblocks the medium again.
 * @param handle - the open handle.
 */
export function closeExclusive(handle: number): void {
  win32().closeHandle(handle)
}

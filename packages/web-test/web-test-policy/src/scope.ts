/**
 * Canonical path and origin resolution: the facts a decision compares.
 *
 * A decision runs inside a synchronous tool guard, so it cannot await a path
 * resolution. Every target is therefore resolved here with the synchronous
 * `lstat`/`realpath` pair, and the rule is deliberately strict: a target is
 * usable only when it already exists, is not a link, and canonically resolves.
 *
 * Resolving through the filesystem is also what makes containment trustworthy
 * without a platform branch. `realpath` returns the spelling the filesystem
 * itself uses, so two spellings of one path compare equal and a sibling whose
 * name merely begins with the root's characters is not inside the root on any
 * host. A link is refused rather than followed, which closes the substitution
 * where a link inside the code root points somewhere the root does not cover.
 *
 * @module @deepseek-ai/dsh-web-test-policy/scope
 */

import { lstatSync, realpathSync } from 'node:fs'

/** Why one path could not be reduced to a canonical identity. */
export type PathRejection =
  /** The path is a symbolic link or junction; its target is not the policy's to follow. */
  | 'link'
  /** The path does not exist, or could not be stat'd or resolved at all. */
  | 'unresolved'

/** One resolved path identity, or the reason it could not be established. */
export type ResolvedPath =
  /** The path's canonical, existing identity. */
  | { readonly ok: true; readonly real: string }
  /** The path is a link, or is absent or unresolvable. */
  | { readonly ok: false; readonly rejection: PathRejection }

/**
 * Reduce one absolute path to the canonical identity the filesystem reports.
 *
 * `lstat` runs first so a link is reported as a link rather than silently
 * resolved to its target, and `realpath` runs second so every comparison the
 * policy makes is between two canonical spellings.
 * @param path - absolute path as the caller named it.
 * @returns the canonical identity, or why it could not be established.
 */
export function resolvePath(path: string): ResolvedPath {
  try {
    if (lstatSync(path).isSymbolicLink()) return { ok: false, rejection: 'link' }
    return { ok: true, real: realpathSync(path) }
  } catch {
    // A missing path, a permission failure, and a path whose parent does not
    // exist are the same fact to this package: a target it cannot canonically
    // name is one it will not reason about.
    return { ok: false, rejection: 'unresolved' }
  }
}

/**
 * Reduce one path to the form a containment comparison uses: forward slashes and
 * no trailing separator, so `C:/projects/shop` and `C:\projects\shop\` are one
 * path rather than two spellings. A one-character path keeps its own separator,
 * which is what keeps a mount point recognizable.
 * @param canonical - an already-canonical path.
 * @returns the comparable form.
 */
export function comparablePath(canonical: string): string {
  let end = canonical.length
  while (end > 1 && (canonical[end - 1] === '/' || canonical[end - 1] === '\\')) end -= 1
  return canonical.slice(0, end).replace(/\\/gu, '/')
}

/**
 * Whether one canonical path is a directory or lies beneath it.
 *
 * A root covers itself and what is beneath it, never a sibling whose name
 * begins with the root's characters: `C:/projects/shop` does not cover
 * `C:/projects/shop-evil/src/cart.ts`. A bare POSIX mount point is the
 * separator itself, which every absolute path is beneath.
 * @param rootCanonical - the canonical root.
 * @param candidateCanonical - the canonical candidate.
 * @returns whether the candidate is the root or lies beneath it.
 */
export function isInside(rootCanonical: string, candidateCanonical: string): boolean {
  const root = comparablePath(rootCanonical)
  const candidate = comparablePath(candidateCanonical)
  if (candidate === root) return true
  if (root === '/') return true
  return candidate.startsWith(`${root}/`)
}

/**
 * Reduce one absolute URL to the origin every same-site check compares.
 *
 * Only the two schemes the web capability retrieves are accepted, and the
 * default port is dropped so `https://shop.test:443` and `https://shop.test`
 * are one origin rather than two.
 * @param url - the absolute URL as the caller named it.
 * @returns the origin, or `null` when the URL is not an absolute HTTP(S) URL.
 */
export function originOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // `URL` already drops a scheme's default port, so `https://shop.test:443` and
  // `https://shop.test` are one origin here and no further normalization is
  // needed; the host is only folded so the comparison is case-insensitive.
  return `${parsed.protocol}//${parsed.host.toLowerCase()}`
}

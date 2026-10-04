/**
 * What one published project's declared material is on this host, read without
 * changing anything.
 *
 * **A declaration is not a readiness claim.** A project's record says which code
 * roots and which already-started URLs the user provided; it says nothing about
 * whether those addresses are usable right now. This read compares the two, and
 * reports each fact separately, so a caller that wants to show readiness has to
 * say which facts it checked. Nothing here is stored, and nothing here writes.
 *
 * **A declared target this host cannot use keeps its record.** Every declared
 * code root and every declared entry URL produces a finding whatever that
 * finding is, so an absent or unusable target is reported rather than dropped —
 * and a project holding one is not `complete`. Dropping it would leave the user
 * with a tree they named and no record of why it is not there.
 *
 * **An entry URL is judged as an address, not as a reachability result.** Whether
 * a declared URL answers, needs a login, or serves a production environment is
 * what the project onboarding step records, and this stage does not reach the
 * network at all: `usable` for an entry URL means the declaration names an
 * absolute `http`/`https` address, and nothing more. The URL parser is what
 * refuses a relative or malformed spelling, so a hostless `http` declaration
 * arrives here as an unparsable address rather than as a parsed one. The login
 * and test-environment facts arrive beside it in the environment declaration the
 * user confirmed, and this read never infers them.
 *
 * **This stage changes nothing about the project under test.** It stats a path
 * and parses a URL; it installs no dependency, starts no server, and deploys
 * nothing, and it holds no capability that could. A project whose tree is absent
 * stays absent, which is the answer the user gets and the only one this stage
 * may give.
 *
 * **A path this host cannot stat is absent material.** `statSync` fails on a name
 * the platform itself rejects, and a read that reported such a path as present
 * would invent material that cannot be opened.
 *
 * @module @deepseek-ai/dsh-web-test-runtime/inspection
 */

import { statSync } from 'node:fs'
import { URL } from 'node:url'
import type { Stats } from 'node:fs'
import type { ProjectMetadata } from '@deepseek-ai/dsh-web-test-contracts'

/** How one declared fact stands on this host. */
export type MaterialState =
  /** The declaration names something this host can use as declared. */
  | 'usable'
  /** The declaration is well-formed but names nothing this host holds. */
  | 'absent'
  /** The declaration names something of the wrong kind to use as declared. */
  | 'unusable'

/** One declared fact about a project, with what this host found. */
export interface MaterialCheck {
  /** How the declaration stands on this host. */
  readonly state: MaterialState
  /** The value as the project declared it, unmodified. */
  readonly declared: string
  /** What the state means for this declaration, for a caller that shows it. */
  readonly detail: string
}

/** Every declared fact of one project, each judged on its own. */
export interface ProjectInspection {
  /** The published record these facts were read from. */
  readonly project: ProjectMetadata
  /**
   * Each declared code root as a directory on this host, in declaration order.
   *
   * A root this host cannot use is kept in this list rather than left out of
   * it: the record a caller reads is how the user learns which of the trees they
   * named is missing, and a dropped root is one they would never hear about
   * again. An unusable entry in the list is what keeps the project from being
   * reported as ready.
   */
  readonly codeRoots: readonly MaterialCheck[]
  /** Each declared entry URL, in declaration order, kept on the same terms. */
  readonly entryUrls: readonly MaterialCheck[]
  /**
   * Whether every declared fact is `usable`. It is a statement about the
   * addresses the project declared and nothing else: it does not say the project
   * builds, that a URL answers, or that the environment is safe to act on.
   */
  readonly complete: boolean
}

/**
 * Judge one declared code root as a directory on this host.
 * @param codeRoot - the absolute path the project declared.
 * @returns the finding, which is `absent` for a path this host cannot stat.
 */
function inspectCodeRoot(codeRoot: string): MaterialCheck {
  let stats: Stats | undefined
  try {
    stats = statSync(codeRoot, { throwIfNoEntry: false })
  } catch (error: unknown) {
    // A name the platform rejects outright — an embedded NUL, a path past the
    // platform's own limit — is material this host does not hold, and a read
    // that raised instead would fail a status question over a fact it only
    // reports.
    return {
      state: 'absent',
      declared: codeRoot,
      detail: `this host cannot look at this path at all: ${String(error)}`,
    }
  }
  if (stats === undefined) {
    return { state: 'absent', declared: codeRoot, detail: 'no directory exists at this path on this host' }
  }
  if (!stats.isDirectory()) {
    return { state: 'unusable', declared: codeRoot, detail: 'this path exists but is not a directory' }
  }
  return { state: 'usable', declared: codeRoot, detail: 'an existing directory on this host' }
}

/**
 * Judge one declared entry URL as an address, without contacting it.
 * @param entryUrl - the URL the project declared.
 * @returns the finding; `unusable` for anything that is not an absolute http(s) address.
 */
function inspectEntryUrl(entryUrl: string): MaterialCheck {
  let parsed: URL
  try {
    parsed = new URL(entryUrl)
  } catch {
    // `URL` refuses a relative spelling and a malformed one alike, and both are
    // declarations this stage cannot act on.
    return { state: 'unusable', declared: entryUrl, detail: 'this is not an absolute URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { state: 'unusable', declared: entryUrl, detail: `this is a ${parsed.protocol} URL, not an http or https address` }
  }
  return { state: 'usable', declared: entryUrl, detail: 'an absolute http or https address; its reachability is not read here' }
}

/**
 * Read every declared fact of one published project, as this host finds it.
 *
 * A project that declared no entry URL is `complete` on that account: the list
 * is empty and an empty list of unusable addresses is not a defect. The same is
 * not true of a code root — a project declares at least one, and a root this
 * host cannot use leaves a record that is kept and that keeps `complete` false.
 * @param project - the published record to read the declarations from.
 * @returns each declared fact with its own finding.
 */
export function inspectProjectMetadata(project: ProjectMetadata): ProjectInspection {
  const codeRoots = project.codeRoots.map(inspectCodeRoot)
  const entryUrls = project.entryUrls.map(inspectEntryUrl)
  return {
    project,
    codeRoots,
    entryUrls,
    complete: codeRoots.every(root => root.state === 'usable')
      && entryUrls.every(entry => entry.state === 'usable'),
  }
}

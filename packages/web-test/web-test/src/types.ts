/** Shared types for the Web testing assembly. @module @deepseek-ai/dsh-web-test/types */

import { Branded } from '@deepseek-ai/dsh-brand'
import type { WebTestLocaleKey } from './locales.ts'

/** Opaque identity for one entry point, so an unavailable action is never guessed by string. */
export type WebTestEntryPointId = Branded<'WebTestEntryPointId'>

/** Opaque identity for the Loader entry this application owns, so a foreign row is never matched by string. */
export type WebTestEntryId = Branded<'WebTestEntryId'>

/** Application identity labels; the launcher and installer own their enforcement. */
export interface WebTestIdentity {
  /** Application identity used for its own artifacts and update channel. */
  readonly applicationId: string
  /** Intended data-root name; this field does not change `DSH_HOME`. */
  readonly dataRootName: string
  /** Intended profile label; the launcher selects the running profile. */
  readonly profileName: string
}

/** Configuration for {@link WebTest}; every field has a default. */
export interface WebTestConfig {
  /** Application identity; distinct from the official product so both may be installed. */
  applicationId: string
  /** Intended data-root name; this field does not change `DSH_HOME`. */
  dataRootName: string
  /** Intended profile label; the launcher selects the running profile. */
  profileName: string
}

/** An intended entry declaration; no Client control is registered by this type. */
export interface WebTestEntryPoint {
  /** Stable identity callers use to ask whether the point is available. */
  readonly id: WebTestEntryPointId
  /** Key of this application's dictionary; a Client consumer renders it through `t`. */
  readonly titleKey: WebTestLocaleKey
  /** Profile this entry point belongs to. */
  readonly profileName: string
}

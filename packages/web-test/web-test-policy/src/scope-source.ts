/**
 * The one read the policy makes of published project scope.
 *
 * The policy owns no durable state of its own. A project's code root, entry
 * URLs, and monotonic revision are published by the single domain writer
 * (`ctx.webTestRuntime`) through its own stage/publish/fold protocol, and this
 * seam is the only way the policy sees them. Reading the committed scope is
 * therefore also how a decision notices a scope change: the revision the grant
 * was made against stops being the revision the head publishes, and every
 * authorization bound to the old one stops applying.
 *
 * Keeping the seam abstract is what lets the decision logic be a pure function
 * of published facts. The runtime-backed implementation is constructed by the
 * composition, where the single writer exists; a test constructs one over a
 * reader it controls. Neither needs the other's platform.
 *
 * @module @deepseek-ai/dsh-web-test-policy/scope-source
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ProjectId, ProjectMetadata } from '@deepseek-ai/dsh-web-test-contracts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webTestScopeSource: WebTestScopeSource
  }
}

/** The published scope reader this policy depends on. */
export interface ProjectScopeReader {
  /**
   * Read one project's committed scope.
   * @param projectId - the project to read.
   * @returns the published metadata, or `undefined` when no entry is published.
   */
  readProject(projectId: ProjectId): ProjectMetadata | undefined
}

/** The Service Definition every scope source implements. */
export abstract class WebTestScopeSource extends Service {
  /**
   * Read one project's published scope.
   * @param projectId - the project to read.
   * @returns the published metadata, or `undefined` when the head publishes no entry.
   */
  abstract readProject(projectId: ProjectId): ProjectMetadata | undefined
}

/** The scope source a production composition mounts over the single domain writer. */
export class WebTestRuntimeScope extends WebTestScopeSource {
  private readonly reader: ProjectScopeReader

  /**
   * @param ctx - Context of the Runtime Scope plugin.
   * @param reader - the single domain writer's project read.
   */
  constructor(ctx: Context, reader: ProjectScopeReader) {
    super(ctx, 'webTestScopeSource')
    this.reader = reader
  }

  /**
   * Read the scope the catalog head publishes for one project. An unpublished
   * project reads as `undefined` rather than as empty scope, so a reservation or
   * a half-built project is never mistaken for one with nothing to protect.
   * @param projectId - the project to read.
   * @returns the published metadata, or `undefined` when no entry is published.
   */
  override readProject(projectId: ProjectId): ProjectMetadata | undefined {
    return this.reader.readProject(projectId)
  }
}

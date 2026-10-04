/**
 * Which tools one Web testing conversation may see, and the per-agent mask that
 * states it.
 *
 * **The mask is visibility; the policy is enforcement.** The web testing policy
 * already refuses every governed call it does not admit, so masking a tool does
 * not grant it and unmasking one does not permit it. What the mask decides is
 * what the model is *offered*: a tool this stage does not act through is absent
 * from the conversation's schema rather than present and refusing, so a model
 * cannot read it as a working control.
 *
 * **The governed set is the policy's own.** Names come from the policy's adapter
 * table crossed with the global registry, so a tool the policy does not govern is
 * never masked and a governed name the deployment does not ship is never named —
 * naming an unknown global tool is a load-time failure, not a silent no-op.
 *
 * **One mask per agent, swapped as its context changes.** `tools.restrict()`
 * takes effect when it is called and is lifted by the disposer it returns, so
 * the gate installs the next mask before releasing the current one. Restrictions
 * intersect, which makes the overlap the stricter of the two states rather than
 * a gap in which nothing is masked.
 *
 * @module @deepseek-ai/dsh-web-test-conversation/gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { adaptedToolNames } from '@deepseek-ai/dsh-web-test-policy'
// This import is what brings the `ctx.tools` augmentation into the program.
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Tools this stage's conversation acts through once its session is attached to a
 * project whose environment the policy has confirmed: reading and enumerating
 * the tested code root. Every other governed tool — writing or editing a file
 * under that root, `web_fetch` and `web_search`, a shell, and the terminal
 * capability — is absent from a Web testing conversation, and the policy refuses
 * those effects independently of anything this list says.
 */
export const CONVERSATION_CAPABILITY_TOOLS: readonly string[] = ['read', 'read_image', 'glob', 'grep']

/**
 * Every globally registered tool the web testing policy governs.
 * @param ctx - context whose global registry is read.
 * @returns the governed names this deployment actually ships, sorted.
 */
export function governedToolNames(ctx: Context): string[] {
  const governed = new Set(adaptedToolNames())
  return ctx.tools.schemas()
    .map(schema => schema.name)
    .filter(name => governed.has(name))
    .sort()
}

/**
 * The governed tools this stage does not act through, which therefore read as
 * unavailable rather than as a control with nothing behind it.
 * @param governed - the governed names this deployment ships.
 * @returns the governed names outside {@link CONVERSATION_CAPABILITY_TOOLS}.
 */
export function unimplementedToolNames(governed: readonly string[]): string[] {
  return governed.filter(name => !CONVERSATION_CAPABILITY_TOOLS.includes(name))
}

/**
 * The names one conversation agent's mask denies.
 *
 * A session with no attached project, or one whose environment the policy has
 * not confirmed, is denied the whole governed set: an ordinary conversation stays
 * an ordinary conversation, and it cannot reach a project's context at all. A
 * confirmed session is denied only the tools this stage does not act through.
 * @param governed - the governed names this deployment ships.
 * @param permitted - whether the agent's own session is attached and declared.
 * @returns the names to deny, in the order the mask is installed.
 */
export function deniedToolNames(governed: readonly string[], permitted: boolean): string[] {
  return permitted ? unimplementedToolNames(governed) : [...governed]
}

/**
 * The one scoped mask one conversation agent carries.
 *
 * The mask is registered through the owning plugin's context, so unloading the
 * plugin lifts it, and it is scoped to `agent.ctx`, so it never reaches another
 * conversation. Creating no mask at all is the correct end state for an agent
 * whose deployment governs nothing it must hide.
 */
export class ConversationToolGate {
  private current: (() => Promise<void>) | undefined

  /**
   * @param owner - context of the plugin whose lifetime the mask follows.
   * @param agent - the conversation agent whose scope the mask restricts.
   */
  constructor(private readonly owner: Context, private readonly agent: Agent) {}

  /**
   * Install a mask denying exactly `deny`, releasing the one this agent carried.
   *
   * The next mask is installed before the previous one is released, so the
   * interval in which both apply denies the union of the two — the stricter
   * state — rather than the empty intersection.
   * @param deny - the global tool names to hide from this agent, or none to
   * leave the agent unmasked.
   */
  refresh(deny: readonly string[]): void {
    const previous = this.current
    if (deny.length === 0) {
      this.current = undefined
      void previous?.()
      return
    }
    this.current = this.owner.effect(
      () => this.agent.ctx.tools.restrict({ deny: [...deny] }),
      'webTestConversation.toolGate',
    )
    void previous?.()
  }

  /** Release this agent's mask, if it carries one. */
  dispose(): void {
    const previous = this.current
    this.current = undefined
    void previous?.()
  }
}

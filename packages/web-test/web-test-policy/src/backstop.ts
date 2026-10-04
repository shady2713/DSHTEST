/**
 * The service-level backstop: the second enforcement point.
 *
 * The tool registry's guard covers every model-initiated call, because every one
 * of them reaches `ToolRuntime.execute`. It covers nothing else. `ctx.fs`,
 * `ctx.web`, `ctx.subprocess`, `ctx.shell`, `ctx.attachments`, and
 * `ctx.terminals` are public services, and their consumers call them directly —
 * a plugin, a skill body, a future executor, or a future native driver reaches
 * every one of them without a tool in the path. A policy that exists only at the
 * tool registry is therefore a policy those consumers walk past, which is the
 * design gap the pre-execution choke point cannot close.
 *
 * This module closes it without editing an official product package. Each
 * mutating or reading method is replaced on the service instance the context
 * provided, with an own property that the effect disposer removes, so the
 * original prototype method is what runs again afterwards. The replacement asks
 * the same ledger the tool guard asks; there is one decision, reached from two
 * places.
 *
 * **What the backstop covers.** Every method of those six Service Definitions
 * that can read material, change material, derive a process, or operate a
 * terminal, and no others: 7 on `ctx.fs`, 1 on `ctx.shell`, 2 on
 * `ctx.subprocess`, 2 on `ctx.web`, 17 on `ctx.attachments`, and 4 on
 * `ctx.terminals`. The README's method table is the full derivation and states
 * why each remaining method is not one of them.
 *
 * **What the backstop cannot cover, stated plainly.** It holds only while this
 * plugin's effect is live. Injection installs it on late and replacement
 * providers; retired instances retain it for consumers still holding them.
 * Two things remain outside it, and each of them is
 * a property of the product rather than of this package:
 *
 * - **A captured method reference.** A consumer that read `ctx.fs.readText`
 *   into a variable before the effect installed holds the unwrapped function,
 *   and nothing this package can do reaches it. Deciding such a call needs a
 *   decision point inside the Service Definition, not a property on one
 *   instance.
 * - **A backend's exported functions.** `subprocess-local`, `fs-local`, and
 *   `attachment-local` export their own entry points, and importing one
 *   directly is not a call on the service. The same fix applies: the gate
 *   belongs where the product declares the seam.
 *
 * One further limit is not a hole in the backstop and is stated where it
 * matters: a `ctx.fs` call receives an `FsTarget` the backend has already
 * resolved to an absolute path, so the decision is made at the resolved
 * location and cannot tell a relative spelling from an absolute one. The README
 * says what that means for a relative path.
 *
 * @module @deepseek-ai/dsh-web-test-policy/backstop
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Replace one service method with a replacement, and return the exact disposer
 * that restores the original.
 *
 * The replacement is an own property on the instance, so the prototype method is
 * untouched and deleting the own property restores it exactly — the backstop
 * leaves no trace on the service it guards once it is disposed.
 * @param service - the service instance whose method is decorated.
 * @param method - the method to replace.
 * @param wrap - receives the original method and returns its replacement.
 * @returns the disposer that restores the original method.
 */
export function decorateMethod<S extends object, M extends keyof S>(
  service: S,
  method: M,
  wrap: (original: S[M]) => S[M],
): () => void {
  const had = Object.hasOwn(service, method)
  const original = service[method]
  Object.defineProperty(service, method, {
    value: wrap(original),
    configurable: true,
    writable: true,
    enumerable: false,
  })
  return () => {
    if (had) {
      Object.defineProperty(service, method, {
        value: original,
        configurable: true,
        writable: true,
        enumerable: false,
      })
      return
    }
    Reflect.deleteProperty(service, method)
  }
}

/**
 * Read one service this policy may or may not gate, without declaring it as a
 * dependency.
 *
 * A deployment that mounts no terminal capability has no terminal to gate, and
 * requiring the service would turn that into a load failure rather than leaving
 * the decision to the composition. `ctx.reflect.get` is the only Cordis read
 * that answers "is this provided right now" without the inject requirement, and
 * it reports an instance from the store; the assertion is to the caller's own
 * service type, which is the interface the composition registered under that
 * key.
 * @param ctx - the context to read from.
 * @param name - the Cordis service key.
 * @returns the provided service, or `undefined` when it is not provided.
 */
// The key is a plain string because a deployment may provide a capability this
// package's own Context surface does not declare; the caller's service type is
// the only witness, which is why the parameter appears once.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function optionalService<S>(ctx: Context, name: string): S | undefined {
  return ctx.reflect.get(name) as S | undefined
}

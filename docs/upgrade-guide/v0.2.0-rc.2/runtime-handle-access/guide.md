---
kind: upgrade-guide
description: "Update dynamic Host packages that read or modify raw runtime handles through injected services."
---

# Dynamic Host runtime handle access

English | [中文](guide.zh.md)

## Change

Dynamic Host packages could previously receive unwrapped runtime objects through injected service properties, method results, event arguments and callback receivers. The Host runner now recursively guards returned Agent, Scope and Service objects, including handles inside arrays and resolved asynchronous results. Event, effect, timer and service callbacks also receive guarded arguments and receivers. Cordis Context values are rejected. Framework symbols, including `Symbol.for('cordis.original')`, are unavailable, and reflective property descriptors expose guarded access rather than raw instance state. Assigning, defining or deleting properties on guarded runtime objects is refused.

Live `Map` and `Set` state is rejected. Array, binary and plain JSON data remain readable. This affects dynamic packages that inspect private runtime fields, mutate returned handles, or use reflection to recover the original service. Public service methods remain the supported way to operate on the runtime; their own authorization requirements still apply. The [Host runner](../../../../packages/extensions/cordis-host-runner/README.md) owns dynamic-package execution.

## Migration

Dynamic tool execution metadata also guards the calling Agent. Trusted `setup` callbacks passed to service `create`, `resume` or `createAgent` are refused, including factory aliases. Move scoped Agent composition into an installed Host provider; keep dynamic-package effects on the package's own `ctx`.

1. Update your dynamic package's Host `apply(ctx)` code and handlers to use the public methods of services declared in `inject`. Remove reads of another object's `.ctx`, original-service symbols and descriptor `.value` fields used to recover runtime objects.
2. Replace direct access to private `Map` or `Set` fields with public query methods. If you own the provider, return the required plain JSON data through a public method. Await asynchronous results and use returned handles through their public methods; do not assign, define or delete their properties.
3. Re-run the package's existing actions and queries. Confirm that supported array, binary and JSON reads still succeed, while Context access, original-service recovery, live-container access and runtime-property mutation fail. The [sandbox-context regressions](../../../../packages/extensions/cordis-host-runner/tests/sandbox-context.spec.ts) cover these refusals.

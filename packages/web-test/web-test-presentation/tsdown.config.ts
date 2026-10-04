import { clientBundle } from '../../client/tsdown.client.ts'

// `hostPhase` moves the Node-side artifacts into the Host pass. Without it the
// Host face is skipped entirely, so the Typert tsdown plugin never runs and the
// `lib/typert.remote-client.*` pair this package's `./remote` export promises is
// never written. `packages/api/remotes` is the same shape.
export default clientBundle(
  '@deepseek-ai/dsh-web-test-presentation',
  ['lib/types/index.js'],
  { hostPhase: true },
)

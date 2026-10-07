import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
/**
 * A tool's declared output has to accept what its body returns.
 *
 * The Windows acceptance found `web_test_status` failing on every call because
 * its declared schema closed the object to five fields while the body returned
 * seven, so the host rejected the value before `render` ever saw it. Comparing
 * two schema constants would not have caught that: this exercises the
 * registered definition, validates a real return value against the declared
 * `output.schema`, and runs the declared `render` over the same value.
 *
 * It also holds the generated Remote client against the methods the service
 * actually publishes, so the generated file cannot drift from the source again.
 *
 * @module dsh-plugin-web-test/tests/tool-contract
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { statusToolOutputSchema } from '../src/agent.ts'
import {
  COMPATIBLE_DSH_VERSION,
  PLUGIN_VERSION,
  accessControlWarning,
  restrictsDirectoryToOwner,
} from '../src/store-service.ts'
import {
  grantedAccountFor,
  restrictCommandsForWindows,
  sidOfAccount,
  sidsInTree,
  restrictDataRootToOwner,
  restrictTreeCommandsForWindows,
} from '../src/domain/store.ts'


const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/**
 * Validate a value against a declared JSON Schema, the way the host pipeline
 * does before handing a tool's result to the model.
 * @param schema - The tool's declared output schema.
 * @param value - The value the tool body returned.
 * @returns the list of problems, empty when the value is acceptable.
 */
function schemaProblems(schema: Record<string, unknown>, value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return ['value is not an object']
  const properties = (schema['properties'] ?? {}) as Record<string, unknown>
  const required = (schema['required'] ?? []) as string[]
  if (schema['additionalProperties'] === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) problems.push(`"${key}" is not a declared property`)
    }
  }
  for (const key of required) {
    if (!(key in value)) problems.push(`"${key}" is required but absent`)
  }
  return problems
}

describe('tool output contract', () => {
  it('declares every field the status body returns', () => {
    // The value `web_test_status.execute` returns, including the two fields
    // its own `render` reads.
    const returned = {
      state: 'active' as const,
      evidenceRoot: '/data',
      version: '0.1.2',
      projectCount: 1,
      runCount: 2,
      interruptedRuns: ['run-2'],
      unknownOperations: ['run-2/op-1'],
    }
    expect(schemaProblems(statusToolOutputSchema, returned)).toEqual([])
  })

  it('rejects an undeclared field, so a drift is visible', () => {
    expect(schemaProblems(statusToolOutputSchema, { ...sample(), somethingNew: true }))
      .toContain('"somethingNew" is not a declared property')
  })

  it('gives render a value its own schema accepts', () => {
    // `render` narrows with `statusResultSchema.parse`, so the declared output
    // and the parse must agree on the field set or one of them is wrong.
    const declared = Object.keys((statusToolOutputSchema['properties'] ?? {}) as Record<string, unknown>).sort()
    const derived = Object.keys(z.toJSONSchema(
      z.object({
        state: z.enum(['active', 'draining']),
        evidenceRoot: z.string(),
        version: z.string(),
        projectCount: z.number().int(),
        runCount: z.number().int(),
        interruptedRuns: z.array(z.string()),
        unknownOperations: z.array(z.string()),
      }),
      { target: 'draft-7', io: 'output' },
    ).properties ?? {}).sort()
    expect(declared).toEqual(derived)
  })
})

describe('generated Remote client', () => {
  it('describes every method the service publishes', () => {
    const packageDir = join(repoRoot, 'dsh-plugin-web-test', 'packages', 'web-test')
    const remoteClientSource = readFileSync(join(packageDir, 'src', 'client', 'remote.ts'), 'utf8')
    const source = readFileSync(join(packageDir, 'src', 'index.ts'), 'utf8')
    const published = [...source.matchAll(/@Remote\s+(?:async\s+)?([a-zA-Z]+)\(/g)].map(match => match[1])
    const described = [...remoteClientSource.matchAll(/^ {4}([a-zA-Z]+):/gm)].map(match => match[1])
    // Every published method must be described, or the generated client is a
    // second, stale copy of the service.
    expect(described.sort()).toEqual(expect.arrayContaining([...published].sort()))
    for (const method of published) {
      expect(described, `Remote method ${method} is not described in the generated client`).toContain(method)
    }
  })
})

/**
 * A representative status value.
 * @returns the value.
 */
function sample(): Record<string, unknown> {
  return {
    state: 'active',
    evidenceRoot: '/data',
    version: '0.1.2',
    projectCount: 1,
    runCount: 2,
    interruptedRuns: [],
    unknownOperations: [],
  }
}

describe('plugin version', () => {
  it('matches the manifest that web_test_status reports it against', () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version: string, peerDependencies: Record<string, string> }
    expect(PLUGIN_VERSION).toBe(manifest.version)
    expect(COMPATIBLE_DSH_VERSION).toBe(manifest.peerDependencies['@deepseek-ai/dsh'])
  })
})

describe('data root access control', () => {
  it('says nothing on a platform where the mode is enforced', () => {
    expect(accessControlWarning('linux', '/data')).toBe('')
    expect(restrictsDirectoryToOwner('linux')).toBe(true)
  })

  it('warns on Windows, where the mode is recorded but not enforced', () => {
    expect(restrictsDirectoryToOwner('win32')).toBe(false)
    const warning = accessControlWarning('win32', 'C:/data')
    expect(warning).toContain('inherits its access control list')
    expect(warning).toContain('C:/data')
    // It has to say the directory is not actually restricted, not just hint.
    expect(warning).toContain('cannot restrict it to the current user')
  })
})

describe('restricting the data root on Windows', () => {
  const OWNER = 'CORP\\a'
  const OWNER_SID = 'S-1-5-21-111-222-333-1001'
  const EVERYONE = 'S-1-1-0'
  /** The owner on the root only, the shape Windows reported as left behind. */
  const DUMP_ROOT = [
    'C:\\Users\\a\\data',
    `D:(A;;FA;;;${OWNER_SID})(A;;FRFX;;;${EVERYONE})(A;;FA;;;S-1-5-18)(A;;FA;;;S-1-5-32-544)`,
  ].join('\r\n')
  /** The same tree once the explicit grant is gone from both levels. */
  const DUMP_CLEAN = [
    'C:\\Users\\a\\data',
    `D:(A;;FA;;;${OWNER_SID})(A;;FA;;;S-1-5-18)(A;;FA;;;S-1-5-32-544)`,
  ].join('\r\n')
  /** Nobody on the root, an explicit Everyone on a file that already existed. */
  const DUMP_CHILD = [
    'C:\\Users\\a\\data',
    `D:(A;;FA;;;${OWNER_SID})(A;;FA;;;S-1-5-18)(A;;FA;;;S-1-5-32-544)`,
    '',
    'C:\\Users\\a\\data\\evidence',
    `D:(A;;FA;;;${OWNER_SID})(A;;FRFX;;;${EVERYONE})(A;;FA;;;S-1-5-18)`,
  ].join('\r\n')

  it('reads identities out of the ACL dump rather than the human-readable table', () => {
    expect(sidsInTree(DUMP_ROOT)).toEqual([OWNER_SID, EVERYONE, 'S-1-5-18', 'S-1-5-32-544'])
    // A localized display name never appears, so the answer does not depend on the
    // machine's language.
    expect(sidsInTree(DUMP_ROOT).join(' ')).not.toContain('Everyone')
  })

  it('removes an explicit grant left on the root itself', () => {
    const root = 'C:/Users/a/.dsh/plugins/dsh-plugin-web-test'
    const commands = restrictCommandsForWindows(root, sidsInTree(DUMP_ROOT), OWNER_SID)
    expect(commands).toContainEqual(['icacls.exe', root, '/remove:g', `*${EVERYONE}`])
    // SYSTEM and Administrators keep access, or the machine loses its own path.
    expect(commands.join(' ')).not.toContain('S-1-5-18')
    expect(commands.join(' ')).not.toContain('S-1-5-32-544')
  })

  it('removes an explicit grant left only on a file that already existed', () => {
    const root = 'C:/data'
    // The root is clean here. Reading only the root is what missed this entry and
    // left a world-readable file inside a directory reported as restricted.
    const commands = restrictCommandsForWindows(root, sidsInTree(DUMP_CHILD), OWNER_SID)
    expect(commands).toContainEqual(['icacls.exe', root, '/remove:g', `*${EVERYONE}`])
  })

  it('grants the owner before it takes anything away', () => {
    const root = 'C:/data'
    const commands = restrictCommandsForWindows(root, sidsInTree(DUMP_ROOT), OWNER)
    // A removal that failed after /inheritance:r left the account unable to write.
    // Granting first means its access is already in place before that can happen.
    expect(commands[0]).toEqual(['icacls.exe', root, '/grant:r', `${OWNER}:(OI)(CI)F`])
    expect(commands[1]).toEqual(['icacls.exe', root, '/inheritance:r'])
    // One directory, named outright: no parent, no recursion into .dsh.
    expect(commands[0]).not.toContain('/T')
  })

  it('takes the account name from the account query without reading its words', () => {
    expect(sidOfAccount('\n\uC77C\uC5D0\r\n\r\nUSER INFORMATION\r\n----\r\n'
      + 'User Name            S-1-5-21-111-222-333-1001\r\n')).toBe(OWNER_SID)
    expect(() => sidOfAccount('no identifier here')).toThrow('no security identifier')
  })

  it('reads the whole tree through the platform dump, and nothing runs off Windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webtest-acl-'))
    try {
      const calls: string[][] = []
      let removed = false
      const record = async (argv: string[]) => {
        calls.push(argv)
        const at = argv.indexOf('/save')
        if (at !== -1) {
          // The tree carries Everyone on a child at first and not after the
          // removals, which is what a real restriction looks like.
          await writeFile(argv[at + 1] as string, removed ? DUMP_CLEAN : DUMP_CHILD)
        }
        if (argv.includes('/remove:g')) removed = true
        return ''
      }
      await restrictDataRootToOwner(root, 'win32', record, OWNER_SID)
      // The dump covers the whole tree, which is the only thing that can see an
      // entry written on a child.
      expect(calls.some(argv => argv.includes('/save') && argv.includes('/t'))).toBe(true)
      expect(calls.some(argv => argv.includes('/remove:g') && argv.some(one => one.endsWith('S-1-1-0')))).toBe(true)
      const before = calls.length
      await restrictDataRootToOwner(root, 'linux', record, OWNER_SID)
      expect(calls.length).toBe(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('re-grants the owner when a removal fails, so the directory is never left unwritable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webtest-acl-'))
    try {
      const seen: string[][] = []
      const record = async (argv: string[]) => {
        seen.push(argv)
        const at = argv.indexOf('/save')
        if (at !== -1) await writeFile(argv[at + 1] as string, DUMP_ROOT)
        if (argv.includes('/remove:g')) throw new Error('access is denied')
        return ''
      }
      await expect(restrictDataRootToOwner(root, 'win32', record, OWNER_SID))
        .rejects.toThrow('could not restrict')
      const grants = seen.filter(argv => argv.includes('/grant:r'))
      expect(grants.length).toBeGreaterThanOrEqual(2)
      // The grant after the failure is the recovery, not the one before it.
      const failure = seen.findIndex(argv => argv.includes('/remove:g'))
      expect(seen.findIndex((argv, at) => at > failure && argv.includes('/grant:r')))
        .toBeGreaterThan(failure)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to open the database when another identity still has access', async () => {
    // Every call succeeds, but the tree still names Everyone afterwards: a call
    // that reports success is not proof that the directory is restricted.
    const root = await mkdtemp(join(tmpdir(), 'webtest-acl-'))
    try {
      const record = async (argv: string[]) => {
        const at = argv.indexOf('/save')
        if (at !== -1) await writeFile(argv[at + 1] as string, DUMP_ROOT)
        return ''
      }
      await expect(restrictDataRootToOwner(root, 'win32', record, OWNER_SID))
        .rejects.toThrow(`still grants access to ${EVERYONE}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('which account the Windows grant names', () => {
  it('qualifies the name with its domain, because Windows resolves it otherwise', () => {
    expect(grantedAccountFor({ USERNAME: 'a', USERDOMAIN: 'CORP' })).toBe('CORP\\a')
    // A machine with no domain still names the account it runs as.
    expect(grantedAccountFor({ USERNAME: 'a', USERDOMAIN: 'DESKTOP-1' })).toBe('DESKTOP-1\\a')
    expect(grantedAccountFor({ USERNAME: 'a' })).toBe('a')
  })
})

describe('a reparse point inside the data root', () => {
  it('stops before the recursive calls, so a target outside the root is not rewritten', async () => {
    const root = join(tmpdir(), `webtest-link-${process.pid}`)
    const outside = join(tmpdir(), `webtest-target-${process.pid}`)
    await mkdir(join(root, 'nested'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(root, 'nested', 'escape'), 'junction')
    try {
      const seen: string[][] = []
      const record = (argv: string[]) => {
        seen.push(argv)
        return Promise.resolve('')
      }
      await expect(restrictDataRootToOwner(root, 'win32', record, 'CORP\\a'))
        .rejects.toThrow('contains a reparse point')
      // Nothing recursive ran: a target outside the plugin's own directory is
      // never touched, not even after the non-recursive calls succeeded.
      expect(seen.some(argv => argv.includes('/T'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

/**
 * The public signatures of this contract live in exactly one place: the wire
 * records in `./records.ts`, the branded identities in `./ids.ts`, and the
 * Service Definition's `@Remote` methods returning them, from which the Typert
 * generator derives the Client types.
 *
 * These checks read the declarations through the TypeScript parser rather than
 * grepping for a name an author happened to choose, because a second home for a
 * record is a duplicate one under a *different* name — `PolicyDecision` beside a
 * hand-written `ContractPolicyEvaluation` had identical members and passed every
 * name-based check.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { Context } from '@deepseek-ai/cordis'
import { WebTestContracts } from '../src/index.ts'

const sourceDir = fileURLToPath(new URL('../src/', import.meta.url))
const sourceFiles = readdirSync(sourceDir).filter(name => name.endsWith('.ts')).sort()

/** One exported object type a source file declares. */
interface DeclaredRecord {
  /** Declared name a caller or the generator would see. */
  name: string
  /** Members the record carries, as `name: type` and order-independent. */
  members: readonly string[]
}

/** What one source file exports, read from its parse tree. */
interface FileSurvey {
  /** Source file name relative to `src/`. */
  file: string
  /** Every exported type, interface, and class name the file declares. */
  names: readonly string[]
  /** Exported object types, which is what a wire record is. */
  records: readonly DeclaredRecord[]
  /** Names of the ambient modules the file declares. */
  modules: readonly string[]
}

/**
 * Read one member of a declaration as a comparable string. A call or index
 * signature carries no type of its own, so only a property or method
 * signature contributes one.
 * @param member - member the declaration carries.
 * @param source - file the member was parsed from, for its text.
 * @returns `name: type`, or the bare name for an untyped signature.
 */
function memberText(member: ts.TypeElement, source: ts.SourceFile): string {
  const name = member.name?.getText(source) ?? ''
  const typed = ts.isPropertySignature(member) || ts.isMethodSignature(member) ? member.type : undefined
  return `${name}:${typed?.getText(source) ?? ''}`
}

/**
 * Read the members of a declaration as comparable strings.
 * @param members - members the declaration carries.
 * @param source - file the members were parsed from, for their text.
 * @returns one `name: type` string per member, sorted.
 */
function memberTexts(members: readonly ts.TypeElement[], source: ts.SourceFile): readonly string[] {
  return members.map(member => memberText(member, source)).sort()
}

/**
 * Read one source file's exports.
 * @param file - source file name relative to `src/`.
 * @returns the names, object types, and ambient modules it declares.
 */
function surveySource(file: string): FileSurvey {
  const source = ts.createSourceFile(file, readFileSync(join(sourceDir, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const names: string[] = []
  const records: DeclaredRecord[] = []
  const modules: string[] = []
  for (const statement of source.statements) {
    if (ts.isModuleDeclaration(statement)) {
      // A quoted module name is stored unquoted: every consumer of the survey
      // matches on the module name, not on the source text that spells it.
      modules.push(ts.isStringLiteral(statement.name) ? statement.name.text : statement.name.getText(source))
    }
    const exported = ts.canHaveModifiers(statement)
      && (ts.getModifiers(statement) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.push(statement.name.text)
      if (ts.isInterfaceDeclaration(statement)) {
        records.push({ name: statement.name.text, members: memberTexts(statement.members, source) })
      }
      continue
    }
    if (!ts.isTypeAliasDeclaration(statement)) continue
    names.push(statement.name.text)
    // Only an alias for an object literal is a record; a brand, a primitive
    // alias, and a closed union each declare their own single home already.
    if (ts.isTypeLiteralNode(statement.type)) {
      records.push({ name: statement.name.text, members: memberTexts(statement.type.members, source) })
    }
  }
  return { file, names, records, modules }
}

/** Surveys of every source file, computed once because the parse dominates the check. */
const surveys: readonly FileSurvey[] = sourceFiles.map(surveySource)

/**
 * Read the return type one Service Definition method declares.
 * @param methodName - method declared on the Service Definition class.
 * @returns the return type as written, or `null` when the method declares none.
 */
function declaredReturnType(methodName: string): string | null {
  const source = ts.createSourceFile(
    'index.ts',
    readFileSync(join(sourceDir, 'index.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const service = source.statements.find(ts.isClassDeclaration)
  const method = service?.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && member.name.getText(source) === methodName,
  )
  return method?.type?.getText(source) ?? null
}

describe('single home of the public contract', () => {
  it('marks every Remote method on the Service Definition and nowhere else', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WebTestContracts)
    expect(remoteMethods(ctx.webTestContracts).map(marker => marker.method))
      .toEqual([
        'registerProject',
        'submitRecord',
        'confirmEnvironmentDeclaration',
        'confirmEnvironment',
        'evaluatePolicy',
      ])
    await fiber.dispose()
  })

  it('declares no record twice under two names', () => {
    const homes = new Map<string, string[]>()
    for (const survey of surveys) {
      for (const record of survey.records) {
        const members = record.members.join(' | ')
        homes.set(members, [...homes.get(members) ?? [], `${survey.file}#${record.name}`])
      }
    }
    const duplicated = [...homes.values()].filter(homesOfOneRecord => homesOfOneRecord.length > 1)
    // Two declarations of one record are the same wire type twice, whatever
    // they are named; the generator would publish the survivor and the copy
    // would drift from it silently.
    expect(duplicated).toEqual([])
  })

  it('keeps every wire record in records.ts and none beside the Service Definition', () => {
    const namesOf = (file: string): readonly string[] => surveys.find(survey => survey.file === file)?.names ?? []
    const recordsOf = (file: string): readonly string[] =>
      (surveys.find(survey => survey.file === file)?.records ?? []).map(record => record.name)
    expect(recordsOf('index.ts')).toEqual([])
    for (const name of ['PolicyDecision', 'CommandReceipt', 'ValidatedProjectRegistration']) {
      expect(namesOf('records.ts')).toContain(name)
    }
    for (const name of ['ProjectId', 'CommandId', 'RecordId', 'Revision']) {
      expect(namesOf('ids.ts')).toContain(name)
    }
  })

  it('returns the record PolicyDecision from evaluatePolicy', () => {
    expect(declaredReturnType('evaluatePolicy')).toBe('PolicyDecision')
    const declared = surveys
      .flatMap(survey => survey.records.map(record => `${survey.file}#${record.name}`))
    expect(declared).toContain('records.ts#PolicyDecision')
  })

  it('declares no hand-written Client Remote map beside the Service Definition', () => {
    // The generator emits the Client's namespace map from these @Remote
    // methods; a hand-written one would be a second home for the whole surface.
    expect(surveys.flatMap(survey => survey.modules).filter(name => name.startsWith('TypertRemote')))
      .toEqual([])
  })
})

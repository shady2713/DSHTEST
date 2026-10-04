/** JSON messages exchanged by the owning Host and its private QuickJS worker. */
import type { PtcBindingErrorClass, PtcJsonValue, PtcRunFailure } from '@deepseek-ai/dsh-ptc-runtime'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'

/** Deployment limits shared with the worker; every field is resolved before run. */
export interface Config {
  /** Default elapsed milliseconds, including setup and Host binding waits. */
  timeoutMs?: number
  /** Maximum finite elapsed budget accepted by resolve. */
  maxTimeoutMs?: number
  /** QuickJS allocator byte ceiling; excludes Worker V8 and WASM module overhead. */
  memoryLimitBytes?: number
  /** QuickJS guest stack ceiling in bytes. */
  maxStackBytes?: number
  /** Combined serialized logs, value and failure envelope ceiling in bytes. */
  maxOutputBytes?: number
  /** Maximum console messages admitted before output failure. */
  maxLogMessages?: number
  /** Per-binding JSON argument or response ceiling in UTF-8 bytes. */
  maxMessageBytes?: number
  /** Maximum concurrent Host binding calls. */
  maxPendingCalls?: number
  /** Program source ceiling in UTF-8 bytes, before type stripping. */
  maxSourceBytes?: number
  /** Guest Promise jobs processed per Worker event-loop yield. */
  maxJobsPerTick?: number
  /** Worker V8 old-generation ceiling in MiB; excludes WASM allocations. */
  workerHeapMb?: number
}

/** All deployment limits after configuration validation and default resolution. */
export type ResolvedConfig = Required<Config>

/** Worker inputs contain JSON metadata and source, never Host functions or Contexts. */
export interface WorkerInput {
  program: string
  deadline: number
  config: ResolvedConfig
  bindings: { global: string; members: string[]; errorClass?: PtcBindingErrorClass }[]
}

/** Worker observations; binding arguments and returned values use lossless JSON text. */
export type WorkerMessage =
  | { kind: 'call'; id: number; global: string; member: string; json: string }
  | { kind: 'log'; text: string }
  | { kind: 'done'; json?: string; error?: PtcRunFailure }

/** A Host binding completion belonging to one worker call. */
export interface HostReply { id: number; json?: string; error?: string }

const failureKinds = new Set(['exception', 'timeout', 'abort', 'worker-exit', 'invalid-output', 'output-limit', 'protocol', 'sandbox-unavailable'])
const configFields = ['timeoutMs', 'maxTimeoutMs', 'memoryLimitBytes', 'maxStackBytes', 'maxOutputBytes', 'maxLogMessages',
  'maxMessageBytes', 'maxPendingCalls', 'maxSourceBytes', 'maxJobsPerTick', 'workerHeapMb'] as const
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function callId(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function failure(value: unknown): value is PtcRunFailure {
  return record(value) && typeof value.kind === 'string' && failureKinds.has(value.kind) && typeof value.message === 'string'
}

/**
 * Validate an actual Worker observation before Host dispatch.
 * @param value - Untrusted message event payload.
 * @returns A supported message with all required fields present.
 * @throws When the message kind or fields do not match the Worker protocol.
 */
export function parseWorkerMessage(value: unknown): WorkerMessage {
  if (!record(value)) throw new Error('Worker message must be a record')
  if (value.kind === 'log' && typeof value.text === 'string') return { kind: 'log', text: value.text }
  if (value.kind === 'call' && callId(value.id) && typeof value.global === 'string' && typeof value.member === 'string' && typeof value.json === 'string') {
    return { kind: 'call', id: value.id, global: value.global, member: value.member, json: value.json }
  }
  if (value.kind === 'done' && (value.json === undefined || typeof value.json === 'string') && (value.error === undefined || failure(value.error))) {
    if (value.json !== undefined && value.error !== undefined) throw new Error('Worker completion cannot contain both a value and failure')
    return { kind: 'done', ...(value.json === undefined ? {} : { json: value.json }), ...(value.error === undefined ? {} : { error: value.error }) }
  }
  throw new Error('Malformed or unsupported Worker message')
}

/**
 * Validate a Host completion before touching QuickJS handles.
 * @param value - Untrusted message event payload.
 * @returns One completion carrying exactly one JSON value or failure message.
 * @throws When required identity or completion fields are absent or invalid.
 */
export function parseHostReply(value: unknown): HostReply {
  if (!record(value) || !callId(value.id)) throw new Error('Malformed Host completion identity')
  if (typeof value.json === 'string' && value.error === undefined) return { id: value.id, json: value.json }
  if (typeof value.error === 'string' && value.json === undefined) return { id: value.id, error: value.error }
  throw new Error('Host completion requires exactly one JSON value or failure')
}

/**
 * Validate private startup data received through Worker structured clone.
 * @param value - Worker startup payload.
 * @returns Source, binding metadata and complete positive deployment limits.
 * @throws When startup fields or nested declarations are invalid.
 */
export function parseWorkerInput(value: unknown): WorkerInput {
  if (!record(value) || typeof value.program !== 'string' || typeof value.deadline !== 'number' || !Number.isFinite(value.deadline) || value.deadline <= 0 || !record(value.config) || !Array.isArray(value.bindings)) throw new Error('Malformed Worker startup data')
  const configRecord = value.config
  const limitOf = (key: typeof configFields[number]): number => {
    const limit = configRecord[key]
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) throw new Error(`Malformed Worker limit ${key}`)
    return limit
  }
  const config: ResolvedConfig = {
    timeoutMs: limitOf('timeoutMs'), maxTimeoutMs: limitOf('maxTimeoutMs'),
    memoryLimitBytes: limitOf('memoryLimitBytes'), maxStackBytes: limitOf('maxStackBytes'),
    maxOutputBytes: limitOf('maxOutputBytes'), maxLogMessages: limitOf('maxLogMessages'), maxMessageBytes: limitOf('maxMessageBytes'),
    maxPendingCalls: limitOf('maxPendingCalls'), maxSourceBytes: limitOf('maxSourceBytes'),
    maxJobsPerTick: limitOf('maxJobsPerTick'), workerHeapMb: limitOf('workerHeapMb'),
  }
  const bindings = value.bindings.map((namespace: unknown) => {
    if (!record(namespace) || typeof namespace.global !== 'string' || !Array.isArray(namespace.members)) throw new Error('Malformed Worker binding declaration')
    const members = namespace.members.map((member: unknown) => {
      if (typeof member !== 'string') throw new Error('Malformed Worker binding member')
      return member
    })
    let errorClass: PtcBindingErrorClass | undefined
    if (namespace.errorClass !== undefined) {
      const descriptor = namespace.errorClass
      if (!record(descriptor) || typeof descriptor.name !== 'string' || typeof descriptor.memberNameProperty !== 'string') throw new Error('Malformed Worker binding error class')
      errorClass = { name: descriptor.name, memberNameProperty: descriptor.memberNameProperty }
    }
    return { global: namespace.global, members, ...(errorClass ? { errorClass } : {}) }
  })
  return { program: value.program, deadline: value.deadline, config, bindings }
}

/**
 * Snapshot binding output before serialization; lossy values are rejected.
 * @param value - Value crossing the binding JSON message channel.
 * @returns JSON text containing a detached lossless snapshot.
 */
export function encodeJson(value: PtcJsonValue): string {
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('Binding value must be lossless JSON')
  return JSON.stringify(snapshot)
}

/**
 * Decode JSON from the private worker channel.
 * @param json - JSON text generated by a validated guest or Host snapshot.
 * @returns The decoded JSON value.
 */
export function decodeJson(json: string): PtcJsonValue {
  const value = JSON.parse(json) as PtcJsonValue
  const snapshot = snapshotJsonValue(value)
  if (snapshot === undefined) throw new Error('Wire value must be lossless JSON')
  return snapshot
}

/** Guest-private captures keep JSON validation stable when user code replaces globals. */
export const GUEST_CODEC = `(() => {
  const stringify = JSON.stringify, parse = JSON.parse, keys = Reflect.ownKeys;
  const desc = Object.getOwnPropertyDescriptor, proto = Object.getPrototypeOf;
  const objectProto = Object.prototype, arrayProto = Array.prototype;
  const isArray = Array.isArray, finite = Number.isFinite, negativeZero = Object.is;
  const ErrorType = Error, SetType = Set;
  const define = Object.defineProperty;
  const add = Function.call.bind(Set.prototype.add), has = Function.call.bind(Set.prototype.has), remove = Function.call.bind(Set.prototype.delete);
  function encode(value) {
    const seen = new SetType();
    function visit(v) {
      if (v === null || typeof v === 'boolean' || typeof v === 'string') return stringify(v);
      if (typeof v === 'number' && finite(v) && !negativeZero(v, -0)) return stringify(v);
      if (typeof v !== 'object' || has(seen, v)) throw new ErrorType('Value must be lossless JSON');
      add(seen, v);
      const array = isArray(v), p = proto(v), names = keys(v);
      if (array ? p !== arrayProto : p !== objectProto && p !== null) throw new ErrorType('Value must be plain JSON');
      if (array && names.length !== v.length + 1) throw new ErrorType('Array must have dense JSON elements');
      let text = '', count = 0;
      for (let index = 0; index < names.length; index++) {
        const key = names[index];
        if (array && key === 'length') continue;
        const d = desc(v, key);
        if (typeof key !== 'string' || !d || !d.enumerable || !('value' in d)) throw new ErrorType('Value must have JSON data properties');
        if (array && key !== '' + count) throw new ErrorType('Array must have JSON indices');
        text += (count++ ? ',' : '') + (array ? '' : stringify(key) + ':') + visit(d.value);
      }
      remove(seen, v);
      return array ? '[' + text + ']' : '{' + text + '}';
    }
    return visit(value);
  }
  function makeError(name, property) {
    const E = class extends ErrorType { constructor(message, member) { super(message); this.name = name; define(this, property, { value: member, enumerable: true }); } };
    define(E, 'name', { value: name });
    return { constructor: E, reject: (message, member) => new E(message, member) };
  }
  return { encode, parse, makeError, error: (message) => new ErrorType(message), format: (...args) => args.map(v => typeof v === 'string' ? v : encode(v)).join(' ') };
})()`

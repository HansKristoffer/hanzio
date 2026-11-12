import {
	DEFAULT_SECRET_TIMEOUT_MS,
	withSecretDeadline,
	type SecretRequestOptions
} from './deadline'
import {
	resolveSecretEnvironment,
	type EnvironmentVariables,
	type SecretEnvironmentOption
} from './environment'
import { SecretLoadError } from './errors'

export type { SecretEnvironment, SecretEnvironmentOption } from './environment'
export { SecretLoadError } from './errors'

export type SecretLogAttributes = {
	readonly environment: string
	readonly count: number
	readonly durationMs: number
	readonly source?: string
	readonly sources?: Readonly<Record<string, number>>
	readonly code?: string
}

/** A transient failure a loader is about to retry. Holds no values, tokens or responses. */
export type SecretRetry = {
	readonly operation: string
	/** 1-based number of the retry about to start. */
	readonly attempt: number
	readonly delayMs: number
	/** `status 503`, `timeout`, or a network error code such as `ECONNREFUSED`. */
	readonly reason: string
}

export type SecretRetryLogAttributes = SecretRetry & {
	readonly environment: string
}

export type SecretLogger = {
	info: (message: string, attributes: SecretLogAttributes) => void
	error: (message: string, attributes: SecretLogAttributes) => void
	/** Called before each retry, so a slow startup shows why it is waiting. */
	warn?: (message: string, attributes: SecretRetryLogAttributes) => void
}

/** Required keys as strings, plus the optional keys that have a value. */
export type SecretValues<K extends string, O extends string = never> = Record<
	K,
	string
> &
	Partial<Record<O, string>>

export type SecretSchema<K extends string, Parsed, O extends string = never> = {
	parseAsync: (values: SecretValues<K, O>) => Promise<Parsed>
}

export type CommonSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>,
	O extends string = never
> = SecretRequestOptions & {
	readonly environment?: SecretEnvironmentOption
	readonly writeToProcessEnv?: boolean
	readonly logger?: SecretLogger | false
	/** Keys that may be missing. List them here only, not in the required keys. */
	readonly optional?: readonly O[]
	readonly schema?: SecretSchema<K, Parsed, O>
}

export type CustomLoaderDefineSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>,
	O extends string = never
> = CommonSecretSetOptions<K, Parsed, O> & {
	readonly loader: SecretSetLoader<NoInfer<K | O>>
}

export type SecretSetLoaderContext<K extends string> = {
	readonly keys: readonly K[]
	readonly environment: string
	readonly signal?: AbortSignal
	readonly timeoutMs?: number

	/** Report the source actually selected by a dynamic loader. */
	readonly reportSource?: (source: string) => void

	/** Report a transient failure before retrying it; logged as `Retrying secret load`. */
	readonly reportRetry?: (retry: SecretRetry) => void
}

export type SecretSetLoader<K extends string> = ((
	context: SecretSetLoaderContext<K>
) => Promise<Partial<Record<K, string>>>) & {
	readonly source?: string
}

export type SecretSet<
	K extends string,
	Parsed = Record<K, string>,
	O extends string = never
> = {
	secret: (key: K) => string
	/** An optional key's value, or undefined when it is missing or empty. */
	optional: (key: O) => string | undefined
	/** Required keys only. */
	secrets: () => Record<K, string>
	parsed: () => Parsed
	/** Labels for required keys and for the optional keys that have a value. */
	sources: () => SecretValues<K, O>
	reload: (options?: SecretRequestOptions) => Promise<SecretSet<K, Parsed, O>>
}

/** A declaration that must be loaded explicitly before its values can be read. */
export type LazySecretSet<
	K extends string,
	Parsed = Record<K, string>,
	O extends string = never
> = SecretSet<K, Parsed, O> & {
	/** Initialize once. Concurrent calls share a load; use reload to refresh. */
	load: (options?: SecretRequestOptions) => Promise<LazySecretSet<K, Parsed, O>>
}

// Shared across bundled entry points and package copies in the same JS realm.
// Only helper-written values are registered; original environment overrides aren't.
const registryKey = Symbol.for('hanzio.secrets.environmentWrites.v1')
const shared = globalThis as typeof globalThis & {
	[registryKey]?: WeakMap<EnvironmentVariables, Map<string, string>>
}
const environmentWrites =
	shared[registryKey] ??
	new WeakMap<EnvironmentVariables, Map<string, string>>()

shared[registryKey] = environmentWrites

const defaultLogger: SecretLogger = {
	// stderr, so a CLI that prints JSON on stdout stays parseable.
	info: (message, attrs) =>
		console.error(
			`${message} environment=${attrs.environment} count=${attrs.count} source=${attrs.source} durationMs=${attrs.durationMs}`,
			{ sources: attrs.sources }
		),
	error: (message, attrs) => console.error(message, attrs),
	warn: (message, attrs) =>
		console.warn(
			`${message} environment=${attrs.environment} operation=${attrs.operation} attempt=${attrs.attempt} delayMs=${attrs.delayMs} reason=${attrs.reason}`
		)
}

function readOverrides<K extends string>(
	keys: readonly K[],
	env?: EnvironmentVariables
): Partial<Record<K, string>> {
	if (!env) {
		return {}
	}

	const writes = environmentWrites.get(env)

	return Object.fromEntries(
		keys.flatMap((key) => {
			const value = Object.hasOwn(env, key) ? env[key] : undefined

			// A matching helper write is a mirror, not an explicit user override.
			if (writes?.has(key)) {
				if (writes.get(key) === value) {
					return []
				}

				// An external change gives ownership back to the environment.
				writes.delete(key)
			}

			return value ? [[key, value]] : []
		})
	) as Partial<Record<K, string>>
}

export function createSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>,
	const O extends string = never
>(
	keys: Keys,
	options: CustomLoaderDefineSecretSetOptions<Keys[number], Parsed, O>,
	environmentVariables?: EnvironmentVariables
): LazySecretSet<Keys[number], Parsed, O> {
	type K = Keys[number]

	const keySet = [...new Set(keys)] as K[]
	const optionalKeys = [...new Set(options.optional ?? [])] as O[]
	const both = optionalKeys.filter((key) => keySet.includes(key as string))

	if (both.length) {
		throw new SecretLoadError(
			'CONFIGURATION',
			`Secret keys cannot be both required and optional: ${both.join(', ')}`
		)
	}

	const allKeys: (K | O)[] = [...keySet, ...optionalKeys]
	let environment: string | undefined
	let initialized = false
	const logger =
		options.logger === false ? undefined : (options.logger ?? defaultLogger)

	// These snapshots change together only after an entire load succeeds.
	let cached: Record<K, string>
	let optionalValues: Partial<Record<O, string>>
	let parsed: Parsed
	let sources: SecretValues<K, O>
	let inFlight: Promise<void> | undefined

	const log = (
		level: 'info' | 'error',
		message: string,
		attributes: SecretLogAttributes
	) => {
		try {
			logger?.[level](message, attributes)
		} catch {
			/* Logging cannot change a load result. */
		}
	}

	// Build, validate, and commit one snapshot under the caller’s deadline.
	const loadSnapshot = async (
		request: SecretRequestOptions,
		signal: AbortSignal,
		environment: string
	) => {
		// Fetch only keys that lack genuine local overrides.
		const local = readOverrides(allKeys, environmentVariables)
		const missing = allKeys.filter((key) => !Object.hasOwn(local, key))
		let loaderSource = options.loader.source ?? 'custom loader'
		let loaded: Partial<Record<K | O, string>> = {}

		if (missing.length) {
			try {
				loaded = await options.loader({
					keys: missing,
					environment,
					signal,
					timeoutMs:
						request.timeoutMs ?? options.timeoutMs ?? DEFAULT_SECRET_TIMEOUT_MS,
					reportSource: (source) => {
						loaderSource = source
					},
					reportRetry: (retry) => {
						try {
							logger?.warn?.('Retrying secret load', { environment, ...retry })
						} catch {
							/* Logging cannot change a load result. */
						}
					}
				})
			} catch (error) {
				if (error instanceof SecretLoadError) {
					throw error
				}

				throw new SecretLoadError('LOADER', 'Secret loader failed.')
			}
		}

		// Honor overrides changed while the loader was running. Keep only
		// nonempty strings: a missing optional key is simply absent.
		const overrides = readOverrides(allKeys, environmentVariables)
		const values = Object.fromEntries(
			allKeys.flatMap((key) => {
				const value = Object.hasOwn(overrides, key)
					? overrides[key]
					: Object.hasOwn(loaded, key)
						? loaded[key]
						: undefined

				return typeof value === 'string' && value ? [[key, value]] : []
			})
		) as Partial<Record<K | O, string>>
		const missingKeys = keySet.filter((key) => !Object.hasOwn(values, key))

		if (missingKeys.length) {
			throw new SecretLoadError(
				'MISSING_SECRETS',
				`Missing secrets: ${missingKeys.join(', ')}`
			)
		}

		const next = Object.fromEntries(
			keySet.map((key) => [key, values[key]])
		) as Record<K, string>

		// Validate the merged snapshot before touching the cache or environment.
		let nextParsed: Parsed

		try {
			nextParsed = options.schema
				? await options.schema.parseAsync({ ...values } as SecretValues<K, O>)
				: ({ ...next } as Parsed)

			// Validate copyability before committing anything.
			nextParsed = structuredClone(nextParsed)
		} catch {
			throw new SecretLoadError(
				'VALIDATION',
				'Secret schema validation failed. Check the configured schema; values are omitted.'
			)
		}

		// A custom loader or schema may ignore cancellation while awaiting.
		// Its late result must never replace the last successful snapshot.
		signal.throwIfAborted()

		const nextSources = Object.fromEntries(
			Object.keys(values).map((key) => [
				key,
				Object.hasOwn(overrides, key) ? 'process.env' : loaderSource
			])
		) as SecretValues<K, O>

		// Register only fetched values so future loads can identify our mirrors.
		if (options.writeToProcessEnv !== false && environmentVariables) {
			let writes = environmentWrites.get(environmentVariables)

			if (!writes) {
				writes = new Map()
				environmentWrites.set(environmentVariables, writes)
			}

			for (const key of allKeys) {
				if (Object.hasOwn(overrides, key)) {
					continue
				}

				const value = values[key]

				if (value !== undefined) {
					environmentVariables[key] = value
					writes.set(key, value)
				} else if (writes.has(key)) {
					// An optional key removed upstream: drop our stale mirror.
					delete environmentVariables[key]
					writes.delete(key)
				}
			}
		}

		cached = next
		optionalValues = Object.fromEntries(
			optionalKeys.flatMap((key) =>
				Object.hasOwn(values, key) ? [[key, values[key]]] : []
			)
		) as Partial<Record<O, string>>
		parsed = nextParsed
		sources = nextSources
		initialized = true
	}

	const load = (request: SecretRequestOptions = {}): Promise<void> => {
		// Concurrent reloads share the first caller's deadline and cancellation.
		if (inFlight) {
			return inFlight
		}

		inFlight = (async () => {
			const start = Date.now()

			try {
				environment ??= resolveSecretEnvironment(
					options.environment,
					environmentVariables
				)
				const resolvedEnvironment = environment

				await withSecretDeadline(
					{
						timeoutMs: request.timeoutMs ?? options.timeoutMs,
						signal: request.signal ?? options.signal
					},
					(signal) => loadSnapshot(request, signal, resolvedEnvironment)
				)

				// Report the sources of committed values, not attempted fetches.
				const sourceCounts = new Map<string, number>()
				const labels = Object.values<string>(sources)

				for (const source of labels) {
					sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
				}

				const counts = Object.fromEntries(sourceCounts)

				log('info', 'Loaded secrets', {
					environment: resolvedEnvironment,
					count: labels.length,
					durationMs: Date.now() - start,
					source: Object.keys(counts).join(' + ') || 'none',
					sources: counts
				})
			} catch (error) {
				const safe =
					error instanceof SecretLoadError
						? error
						: new SecretLoadError('LOADER', 'Secret loading failed.')

				log('error', 'Secret loading failed', {
					environment: environment ?? 'unresolved',
					count: keySet.length,
					durationMs: Date.now() - start,
					code: safe.code
				})

				throw safe
			}
		})().finally(() => {
			inFlight = undefined
		})

		return inFlight
	}

	const assertLoaded = () => {
		if (!initialized) {
			throw new SecretLoadError(
				'CONFIGURATION',
				'Secret set has not been loaded. Await load() before reading values.'
			)
		}
	}

	const secretSet: LazySecretSet<K, Parsed, O> = {
		secret(key) {
			assertLoaded()

			if (!Object.hasOwn(cached, key)) {
				throw new SecretLoadError('MISSING_SECRETS', `Secret ${key} not found`)
			}

			return cached[key]
		},
		optional(key) {
			assertLoaded()

			if (!optionalKeys.includes(key)) {
				throw new SecretLoadError(
					'CONFIGURATION',
					`Secret ${key} is not declared in optional.`
				)
			}

			return Object.hasOwn(optionalValues, key)
				? optionalValues[key]
				: undefined
		},

		// Return copies so consumers cannot mutate the internal snapshots.
		secrets() {
			assertLoaded()

			return { ...cached }
		},
		parsed() {
			assertLoaded()

			return structuredClone(parsed)
		},
		sources() {
			assertLoaded()

			return { ...sources }
		},

		async load(request) {
			if (!initialized) {
				await load(request)
			}

			return secretSet
		},

		async reload(request) {
			await load(request)

			return secretSet
		}
	}

	return secretSet
}

/** Compatibility API: declares and loads a complete snapshot before returning. */
export async function defineSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>,
	const O extends string = never
>(
	keys: Keys,
	options: CustomLoaderDefineSecretSetOptions<Keys[number], Parsed, O>,
	environmentVariables?: EnvironmentVariables
): Promise<SecretSet<Keys[number], Parsed, O>> {
	return createSecretSet(keys, options, environmentVariables).load()
}

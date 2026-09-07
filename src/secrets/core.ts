import { withSecretDeadline, type SecretRequestOptions } from './deadline'
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

export type SecretLogger = {
	info: (message: string, attributes: SecretLogAttributes) => void
	error: (message: string, attributes: SecretLogAttributes) => void
}

export type SecretSchema<K extends string, Parsed> = {
	parseAsync: (values: Record<K, string>) => Promise<Parsed>
}

export type CommonSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>
> = SecretRequestOptions & {
	readonly environment?: SecretEnvironmentOption
	readonly writeToProcessEnv?: boolean
	readonly logger?: SecretLogger | false
	readonly schema?: SecretSchema<K, Parsed>
}

export type CustomLoaderDefineSecretSetOptions<
	K extends string,
	Parsed = Record<K, string>
> = CommonSecretSetOptions<K, Parsed> & {
	readonly loader: SecretSetLoader<K>
}

export type SecretSetLoaderContext<K extends string> = {
	readonly keys: readonly K[]
	readonly environment: string
	readonly signal?: AbortSignal
	readonly timeoutMs?: number

	/** Report the source actually selected by a dynamic loader. */
	readonly reportSource?: (source: string) => void
}

export type SecretSetLoader<K extends string> = ((
	context: SecretSetLoaderContext<K>
) => Promise<Partial<Record<K, string>>>) & {
	readonly source?: string
}

export type SecretSet<K extends string, Parsed = Record<K, string>> = {
	secret: (key: K) => string
	secrets: () => Record<K, string>
	parsed: () => Parsed
	sources: () => Record<K, string>
	reload: (options?: SecretRequestOptions) => Promise<SecretSet<K, Parsed>>
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
	info: (message, attrs) =>
		console.log(
			`${message} environment=${attrs.environment} count=${attrs.count} source=${attrs.source} durationMs=${attrs.durationMs}`,
			{ sources: attrs.sources }
		),
	error: (message, attrs) => console.error(message, attrs)
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

export async function defineSecretSet<
	const Keys extends readonly string[],
	Parsed = Record<Keys[number], string>
>(
	keys: Keys,
	options: CustomLoaderDefineSecretSetOptions<Keys[number], Parsed>,
	environmentVariables?: EnvironmentVariables
): Promise<SecretSet<Keys[number], Parsed>> {
	type K = Keys[number]

	const keySet = [...new Set(keys)] as K[]
	const environment = resolveSecretEnvironment(
		options.environment,
		environmentVariables
	)
	const logger =
		options.logger === false ? undefined : (options.logger ?? defaultLogger)

	// These snapshots change together only after an entire load succeeds.
	let cached: Record<K, string>
	let parsed: Parsed
	let sources: Record<K, string>
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
		signal: AbortSignal
	) => {
		// Fetch only keys that lack genuine local overrides.
		const local = readOverrides(keySet, environmentVariables)
		const missing = keySet.filter((key) => !Object.hasOwn(local, key))
		let loaderSource = options.loader.source ?? 'custom loader'
		let loaded: Partial<Record<K, string>> = {}

		if (missing.length) {
			try {
				loaded = await options.loader({
					keys: missing,
					environment,
					signal,
					timeoutMs: request.timeoutMs ?? options.timeoutMs ?? 30_000,
					reportSource: (source) => {
						loaderSource = source
					}
				})
			} catch (error) {
				if (error instanceof SecretLoadError) {
					throw error
				}

				throw new SecretLoadError('LOADER', 'Secret loader failed.')
			}
		}

		// Honor overrides changed while the loader was running.
		const overrides = readOverrides(keySet, environmentVariables)
		const next = Object.fromEntries(
			keySet.map((key) => {
				if (Object.hasOwn(overrides, key)) {
					return [key, overrides[key]]
				}

				if (Object.hasOwn(loaded, key)) {
					return [key, loaded[key]]
				}

				return [key, undefined]
			})
		) as Record<K, string>
		const missingKeys = keySet.filter(
			(key) => typeof next[key] !== 'string' || !next[key]
		)

		if (missingKeys.length) {
			throw new SecretLoadError(
				'MISSING_SECRETS',
				`Missing secrets: ${missingKeys.join(', ')}`
			)
		}

		// Validate the merged snapshot before touching the cache or environment.
		let nextParsed: Parsed

		try {
			nextParsed = options.schema
				? await options.schema.parseAsync({ ...next })
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
			keySet.map((key) => [
				key,
				Object.hasOwn(overrides, key) ? 'process.env' : loaderSource
			])
		) as Record<K, string>

		// Register only fetched values so future loads can identify our mirrors.
		if (options.writeToProcessEnv !== false && environmentVariables) {
			let writes = environmentWrites.get(environmentVariables)

			if (!writes) {
				writes = new Map()
				environmentWrites.set(environmentVariables, writes)
			}

			for (const key of keySet) {
				if (Object.hasOwn(overrides, key)) {
					continue
				}

				environmentVariables[key] = next[key]
				writes.set(key, next[key])
			}
		}

		cached = next
		parsed = nextParsed
		sources = nextSources
	}

	const load = (request: SecretRequestOptions = {}): Promise<void> => {
		// Concurrent reloads share the first caller's deadline and cancellation.
		if (inFlight) {
			return inFlight
		}

		inFlight = (async () => {
			const start = Date.now()

			try {
				await withSecretDeadline(
					{
						timeoutMs: request.timeoutMs ?? options.timeoutMs,
						signal: request.signal ?? options.signal
					},
					(signal) => loadSnapshot(request, signal)
				)

				// Report the sources of committed values, not attempted fetches.
				const sourceCounts = new Map<string, number>()

				for (const key of keySet) {
					const source = sources[key]

					sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
				}

				const counts = Object.fromEntries(sourceCounts)

				log('info', 'Loaded secrets', {
					environment,
					count: keySet.length,
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
					environment,
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

	const secretSet: SecretSet<K, Parsed> = {
		secret(key) {
			if (!Object.hasOwn(cached, key)) {
				throw new SecretLoadError('MISSING_SECRETS', `Secret ${key} not found`)
			}

			return cached[key]
		},

		// Return copies so consumers cannot mutate the internal snapshots.
		secrets: () => ({ ...cached }),
		parsed: () => structuredClone(parsed),
		sources: () => ({ ...sources }),

		async reload(request) {
			await load(request)

			return secretSet
		}
	}

	await load()

	return secretSet
}

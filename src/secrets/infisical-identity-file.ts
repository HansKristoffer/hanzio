import { z } from 'zod'
import type { EnvironmentVariables } from './environment.js'
import { SecretLoadError } from './errors.js'

const identityFileSchema = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
	siteUrl: z.string().url()
})

/**
 * Machine identity (Universal Auth) credentials kept in a private file for every
 * process on this machine, for example by agentgate, which syncs one identity to
 * all of a user's machines. `INFISICAL_UNIVERSAL_AUTH_FILE` overrides the default
 * `~/.infisical/universal-auth.json`. Only credentials for `siteUrl`'s instance are
 * returned, so a secret is never sent to another Infisical instance.
 */
export async function readInfisicalIdentityFile(
	env: EnvironmentVariables | undefined,
	siteUrl: string
): Promise<{ clientId: string; clientSecret: string } | undefined> {
	// Runtimes without a filesystem (browsers, workers) have no identity file.
	const modules = await Promise.all([
		import('node:fs/promises'),
		import('node:os'),
		import('node:path')
	]).catch(() => undefined)

	if (!modules) {
		return undefined
	}

	const [fs, os, path] = modules
	const file =
		env?.INFISICAL_UNIVERSAL_AUTH_FILE ||
		path.join(os.homedir(), '.infisical', 'universal-auth.json')
	let text: string

	try {
		text = await fs.readFile(file, 'utf8')
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') {
			return undefined
		}

		throw new SecretLoadError(
			'CONFIGURATION',
			`The Infisical identity file ${file} could not be read.`
		)
	}

	let identity: z.infer<typeof identityFileSchema>

	try {
		identity = identityFileSchema.parse(JSON.parse(text))
	} catch {
		// Never echo the file: it holds a client secret.
		throw new SecretLoadError(
			'CONFIGURATION',
			`The Infisical identity file ${file} is not valid; it needs clientId, clientSecret and siteUrl.`
		)
	}

	if (new URL(identity.siteUrl).origin !== new URL(siteUrl).origin) {
		return undefined
	}

	return { clientId: identity.clientId, clientSecret: identity.clientSecret }
}

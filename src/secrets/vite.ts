import type { SecretSet } from '.'

export type ViteSecretSetPlugin = {
	name: string
	config: () => {
		define: Record<string, string>
	}
}

export function getViteDefine<SecretKey extends string>(
	secretSet: SecretSet<SecretKey>
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(secretSet.secrets()).map(([key, value]) => [
			`import.meta.env.${key}`,
			JSON.stringify(value)
		])
	)
}

export function viteSecretSetPlugin<SecretKey extends string>(
	secretSet: SecretSet<SecretKey>
): ViteSecretSetPlugin {
	return {
		name: 'hanzio-secret-set',
		config: () => ({
			define: getViteDefine(secretSet)
		})
	}
}

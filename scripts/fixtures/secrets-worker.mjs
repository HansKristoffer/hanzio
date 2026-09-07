import {
	defineSecretSet,
	cloudflareWorkerEnvLoader
} from 'hanzio/secrets/worker'

export default {
	async fetch(request, env) {
		if (typeof process !== 'undefined') {
			throw new Error('Expected runtime without process')
		}

		const bindings = { ...env }
		const set = await defineSecretSet(['WORKER_FIXTURE'], {
			loader: cloudflareWorkerEnvLoader(bindings),
			logger: false
		})

		bindings.WORKER_FIXTURE = 'refreshed-worker'
		await set.reload()

		return Response.json({
			value: set.secret('WORKER_FIXTURE'),
			sources: set.sources()
		})
	}
}

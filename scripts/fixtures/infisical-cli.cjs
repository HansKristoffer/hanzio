const assert = require('node:assert/strict')
const fs = require('node:fs')

for (const key of [
	'INFISICAL_TOKEN',
	'INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN',
	'TOKEN'
]) {
	assert.equal(process.env[key], undefined)
}

assert.deepEqual(process.argv.slice(2, 6), ['user', 'get', 'token', '--plain'])
assert.ok(process.argv[6].startsWith('--domain=http://127.0.0.1:'))
assert.equal(process.argv[7], '--silent')
assert.equal(process.argv.length, 8)

if (process.env.HANZIO_RUNTIME_CLI_MODE === 'hang') {
	fs.writeFileSync(process.env.HANZIO_RUNTIME_PID_FILE, String(process.pid))
	setInterval(() => {}, 1000)
} else if (process.env.HANZIO_RUNTIME_CLI_MODE === 'fail') {
	console.error('private-error-fixture')
	process.exit(1)
} else {
	const claims = Buffer.from(
		JSON.stringify({
			organizationId: 'login-org',
			exp: 4102444800
		})
	).toString('base64url')

	console.log('eyJhbGciOiJIUzI1NiJ9.' + claims + '.fixture-signature')
}

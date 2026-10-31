import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { interpolate, secretsIn, secretsShown } from '../src/script/load.js'
import { clearSecrets, codeMarker, deleteSecret, getSecret, listSecrets, promptHidden, secretName, setSecret, totp, withCodes } from '../src/secrets.js'
import { holdsSecret, redact } from '../src/util.js'

const withStore = fn => () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-secrets-'))
  try {
    return fn({ secretsFile: join(dir, 'secrets.json') })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('secret names: any case, with or without the TOURWRIGHT_SECRET_ prefix', () => {
  assert.equal(secretName('app_user'), 'APP_USER')
  assert.equal(secretName('TOURWRIGHT_SECRET_PASSWORD'), 'PASSWORD')
  assert.throws(() => secretName('my password'), /not a secret name/)
})

test('saved secrets are read back, listed by name only and deleted', withStore(config => {
  setSecret(config, 'site_user', 'ana@example.com')
  setSecret(config, 'SITE_PASSWORD', 'hunter2!')
  assert.equal(getSecret(config, 'SITE_USER'), 'ana@example.com')
  const list = listSecrets(config).filter(s => s.source === 'saved')
  assert.deepEqual(list.map(s => s.name), ['SITE_PASSWORD', 'SITE_USER'])
  assert.ok(!JSON.stringify(list).includes('hunter2'))
  if (process.platform !== 'win32') assert.equal(statSync(config.secretsFile).mode & 0o777, 0o600)
  assert.equal(deleteSecret(config, 'site_user'), true)
  assert.equal(deleteSecret(config, 'site_user'), false)
  assert.equal(clearSecrets(config), 1)
  assert.equal(existsSync(config.secretsFile), false)
}))

test('the environment wins over the saved value', withStore(config => {
  setSecret(config, 'TOKEN', 'saved')
  process.env.TOURWRIGHT_SECRET_TOKEN = 'from-env'
  try {
    assert.equal(getSecret(config, 'TOKEN'), 'from-env')
  } finally {
    delete process.env.TOURWRIGHT_SECRET_TOKEN
  }
}))

test('${secret:NAME} and ${env:TOURWRIGHT_SECRET_NAME} are the same secret; values leave every log', withStore(config => {
  setSecret(config, 'PASS', 'correct horse')
  const script = { setup: [{ fill: { target: 'x', text: '${secret:pass}' } }], steps: ['${env:TOURWRIGHT_SECRET_PASS}'] }
  assert.deepEqual(secretsIn(script), ['PASS'])
  const out = interpolate(script, { config })
  assert.equal(out.setup[0].fill.text, 'correct horse')
  assert.equal(out.steps[0], 'correct horse')
  assert.equal(redact('fill("correct horse") timed out'), 'fill("•••") timed out')
}))

test('a secret typed on camera is not shown; one in a narration or a caption is', () => {
  const steps = [
    { type: { target: { label: 'Password' }, text: '${secret:PASS}' } },
    { fill: { target: { label: 'User' }, text: '${secret:USER}' } },
    { if: { visible: '#otp', then: [{ say: 'Your code is ${secret:CODE}' }] } },
    { caption: '${secret:TOKEN}' },
  ]
  assert.deepEqual(secretsShown(steps), ['CODE', 'TOKEN'])
})

test('a text that holds a secret value is recognised, to blur the field it is typed into', withStore(config => {
  setSecret(config, 'SHOWN_USER', 'ana@example.com')
  interpolate({ a: '${secret:SHOWN_USER}' }, { config })
  assert.equal(holdsSecret('ana@example.com'), true)
  assert.equal(holdsSecret('demo@example.com'), false)
  assert.equal(holdsSecret(undefined), false)
}))

test('authenticator codes follow RFC 6238, whatever the spacing or case of the key', () => {
  // The RFC's key "12345678901234567890" in base32; its 8-digit codes end in these 6 digits
  const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(totp(key, 59_000), '287082')
  assert.equal(totp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 1_111_111_109_000), '081804')
  assert.throws(() => totp('not a key!'), /not an authenticator key/)
})

test('${totp:NAME} becomes the code when it is typed, not when the script is loaded', withStore(config => {
  setSecret(config, 'APP_TOTP', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  const out = interpolate({ fill: { text: '${totp:APP_TOTP}' } }, { config })
  assert.equal(out.fill.text, codeMarker('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'))
  assert.equal(holdsSecret(out.fill.text), true)
  setSecret(config, 'BAD_TOTP', 'hunter2!')
  assert.throws(() => interpolate({ a: '${totp:BAD_TOTP}' }, { config }), /BAD_TOTP is not an authenticator key/)
  return withCodes(out.fill.text, () => 40_000).then(code => assert.equal(code, '287082'))
}))

test('every missing secret is named at once, with the command that saves it', withStore(config => {
  assert.throws(() => interpolate({ a: '${secret:A_USER}', b: '${secret:A_PASSWORD}' }, { config }), (/** @type {Error} */ err) => {
    assert.match(err.message, /missing secrets: A_USER, A_PASSWORD/)
    assert.match(err.message, /tourwright secret set A_PASSWORD/)
    return true
  })
  assert.throws(() => interpolate('${secret:X}', { config, allowed: false }), /disabled/)
}))

test('a piped value is read whole, without the final newline', async () => {
  assert.equal(await promptHidden('', /** @type {any} */ (Readable.from(['s3cr', 'et\n']))), 's3cret')
})

test('the secrets file is plain JSON a person can inspect', withStore(config => {
  setSecret(config, 'A', 'value')
  assert.equal(JSON.parse(readFileSync(config.secretsFile, 'utf8')).A.value, 'value')
}))

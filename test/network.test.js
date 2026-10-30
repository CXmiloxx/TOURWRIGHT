import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGuard, hostAllowed, isPrivateAddress } from '../src/render/network.js'

test('private and special addresses', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '100.64.0.1']) assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1']) assert.equal(isPrivateAddress(ip), false, ip)
})

test('host allowlist with wildcards', () => {
  assert.equal(hostAllowed('a.example.com', ['*.example.com']), true)
  assert.equal(hostAllowed('example.com', ['*.example.com']), true)
  assert.equal(hostAllowed('badexample.com', ['*.example.com']), false)
  assert.equal(hostAllowed('anything', []), true)
})

test('guard blocks other schemes and private IPs', async () => {
  const guard = createGuard({ allowedHosts: [], blockPrivate: true })
  assert.equal(await guard('file:///etc/passwd'), false)
  assert.equal(await guard('http://127.0.0.1:8080/'), false)
  assert.equal(await guard('http://[::1]/'), false)
  assert.equal(await guard('data:text/plain,hi'), true)
  assert.equal(await guard('https://93.184.215.14/'), true)
})

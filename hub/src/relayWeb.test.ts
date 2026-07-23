import { describe, expect, it } from 'bun:test'
import {
    buildRelayAccessUrl,
    buildRelayOriginPattern,
    isEmbeddedRelayWebEnabled
} from './relayWeb'

describe('embedded relay web mode', () => {
    it('accepts the documented true values', () => {
        expect(isEmbeddedRelayWebEnabled('1')).toBe(true)
        expect(isEmbeddedRelayWebEnabled('true')).toBe(true)
        expect(isEmbeddedRelayWebEnabled('TRUE')).toBe(true)
        expect(isEmbeddedRelayWebEnabled('0')).toBe(false)
        expect(isEmbeddedRelayWebEnabled(undefined)).toBe(false)
    })

    it('builds a same-origin URL when embedded web is enabled', () => {
        const url = buildRelayAccessUrl({
            tunnelUrl: 'https://example.relay.hapi.run',
            officialWebUrl: 'https://app.hapi.run',
            token: 'secret token',
            serveEmbeddedWeb: true,
        })

        expect(url).toBe('https://example.relay.hapi.run/?token=secret+token')
    })

    it('allows only subdomains of the configured relay API origin', () => {
        const pattern = buildRelayOriginPattern('relay.hapi.run')

        expect(pattern.test('https://abc123.relay.hapi.run')).toBe(true)
        expect(pattern.test('https://abc-123.relay.hapi.run')).toBe(true)
        expect(pattern.test('https://relay.hapi.run')).toBe(false)
        expect(pattern.test('https://abc123.relay.hapi.run.evil.example')).toBe(false)
        expect(pattern.test('http://abc123.relay.hapi.run')).toBe(false)
    })

    it('keeps the official web URL behavior by default', () => {
        const url = buildRelayAccessUrl({
            tunnelUrl: 'https://example.relay.hapi.run',
            officialWebUrl: 'https://app.hapi.run',
            token: 'secret token',
            serveEmbeddedWeb: false,
        })

        expect(url).toBe(
            'https://app.hapi.run/?hub=https%3A%2F%2Fexample.relay.hapi.run&token=secret+token'
        )
    })
})

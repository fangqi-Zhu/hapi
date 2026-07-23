import { describe, expect, it } from 'bun:test'
import { buildRelayAccessUrl, isEmbeddedRelayWebEnabled } from './relayWeb'

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

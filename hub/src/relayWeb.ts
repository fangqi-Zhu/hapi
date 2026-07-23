export function isEmbeddedRelayWebEnabled(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true'
}

export function buildRelayOriginPattern(relayApiDomain: string): RegExp {
    const parsed = new URL(
        relayApiDomain.includes('://') ? relayApiDomain : `https://${relayApiDomain}`
    )
    const escapedHostname = parsed.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedPort = parsed.port ? `:${parsed.port.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : ''
    return new RegExp(
        `^${parsed.protocol}//[a-z0-9-]+\\.${escapedHostname}${escapedPort}$`,
        'i'
    )
}

export function buildRelayAccessUrl(options: {
    tunnelUrl: string
    officialWebUrl: string
    token: string
    serveEmbeddedWeb: boolean
}): string {
    const url = new URL(options.serveEmbeddedWeb ? options.tunnelUrl : options.officialWebUrl)

    if (!options.serveEmbeddedWeb) {
        url.searchParams.set('hub', options.tunnelUrl)
    }
    url.searchParams.set('token', options.token)

    return url.toString()
}

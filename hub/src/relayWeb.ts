export function isEmbeddedRelayWebEnabled(value: string | undefined): boolean {
    return value === '1' || value?.toLowerCase() === 'true'
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

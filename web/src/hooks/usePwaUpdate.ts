import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

export const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 1000
export const PWA_UPDATE_RELOAD_FALLBACK_MS = 2000

export async function requestPwaUpdateReload(
    updateSW: ((reloadPage?: boolean) => Promise<void>) | null | undefined,
    options: {
        reloadPage?: () => void
        setTimeoutFn?: typeof setTimeout
        clearTimeoutFn?: typeof clearTimeout
    } = {},
): Promise<void> {
    const reloadPage = options.reloadPage ?? (() => window.location.reload())
    const setTimeoutFn = options.setTimeoutFn ?? setTimeout
    const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout

    if (!updateSW) {
        reloadPage()
        return
    }

    let reloaded = false
    const doReload = () => {
        if (reloaded) {
            return
        }
        reloaded = true
        reloadPage()
    }

    const onControllerChange = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        doReload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    try {
        await updateSW(true)
    } catch (error) {
        console.error('PWA update failed', error)
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        if (fallbackTimer !== undefined) {
            clearTimeoutFn(fallbackTimer)
        }
        doReload()
        return
    }

    fallbackTimer = setTimeoutFn(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
        doReload()
    }, PWA_UPDATE_RELOAD_FALLBACK_MS)
}

export function setupRegistrationUpdateChecks(
    registration: ServiceWorkerRegistration,
): () => void {
    let updateInFlight = false
    const checkForUpdate = () => {
        if (updateInFlight) {
            return
        }

        updateInFlight = true
        void registration.update().catch((error) => {
            console.error('SW update check failed', error)
        }).finally(() => {
            updateInFlight = false
        })
    }

    checkForUpdate()
    const intervalId = window.setInterval(checkForUpdate, PWA_UPDATE_CHECK_INTERVAL_MS)

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            checkForUpdate()
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', checkForUpdate)
    window.addEventListener('online', checkForUpdate)

    return () => {
        window.clearInterval(intervalId)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('focus', checkForUpdate)
        window.removeEventListener('online', checkForUpdate)
    }
}

export function usePwaUpdate() {
    const [needRefresh, setNeedRefresh] = useState(false)
    const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
    const cleanupRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        const updateSW = registerSW({
            onNeedRefresh() {
                setNeedRefresh(true)
            },
            onOfflineReady() {
                console.log('App ready for offline use')
            },
            onRegistered(registration) {
                cleanupRef.current?.()
                cleanupRef.current = null

                if (!registration) {
                    return
                }

                cleanupRef.current = setupRegistrationUpdateChecks(registration)
            },
            onRegisterError(error) {
                console.error('SW registration error:', error)
            },
        })

        updateSWRef.current = updateSW

        return () => {
            cleanupRef.current?.()
            cleanupRef.current = null
            updateSWRef.current = null
        }
    }, [])

    const reload = useCallback(() => {
        void requestPwaUpdateReload(updateSWRef.current)
    }, [])

    return { needRefresh, reload }
}

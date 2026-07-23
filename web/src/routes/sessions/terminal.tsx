import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import type { Terminal } from '@xterm/xterm'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useSession } from '@/hooks/queries/useSession'
import { useTerminalSocket } from '@/hooks/useTerminalSocket'
import { useTranslation } from '@/lib/use-translation'
import { randomId } from '@/lib/randomId'
import { TerminalView } from '@/components/Terminal/TerminalView'
import { LoadingState } from '@/components/LoadingState'
import { isRemoteTerminalSupported } from '@/utils/terminalSupport'

function BackIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function ConnectionIndicator(props: { status: 'idle' | 'connecting' | 'connected' | 'error' }) {
    const isConnected = props.status === 'connected'
    const isConnecting = props.status === 'connecting'
    const label = isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Offline'
    const colorClass = isConnected
        ? 'bg-emerald-500'
        : isConnecting
          ? 'bg-amber-400 animate-pulse'
          : 'bg-[var(--app-hint)]'

    return (
        <div className="flex items-center" aria-label={label} title={label} role="status">
            <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
        </div>
    )
}

const EXIT_NAVIGATION_DELAY_MS = 700

export default function TerminalPage() {
    const { t } = useTranslation()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/terminal' })
    const { api, token, baseUrl } = useAppContext()
    const goBack = useAppGoBack()
    const { session } = useSession(api, sessionId)
    const terminalSupported = isRemoteTerminalSupported(session?.metadata)
    const terminalId = useMemo(() => randomId(), [sessionId])
    const pageRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const inputDisposableRef = useRef<{ dispose: () => void } | null>(null)
    const connectOnceRef = useRef(false)
    const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const exitNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    const {
        state: terminalState,
        connect,
        write,
        resize,
        disconnect,
        onOutput,
        onExit,
    } = useTerminalSocket({
        token,
        sessionId,
        terminalId,
        baseUrl
    })

    useEffect(() => {
        onOutput((data) => {
            terminalRef.current?.write(data)
        })
    }, [onOutput])

    useEffect(() => {
        onExit((code, signal) => {
            setExitInfo({ code, signal })
            terminalRef.current?.write(`\r\n[process exited${code !== null ? ` with code ${code}` : ''}]`)
            if (exitNavTimerRef.current) {
                clearTimeout(exitNavTimerRef.current)
            }
            exitNavTimerRef.current = setTimeout(() => {
                exitNavTimerRef.current = null
                goBack()
            }, EXIT_NAVIGATION_DELAY_MS)
        })
    }, [onExit, goBack])

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === pageRef.current)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        handleFullscreenChange()
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange)
        }
    }, [])

    const handleTerminalMount = useCallback(
        (terminal: Terminal) => {
            terminalRef.current = terminal
            inputDisposableRef.current?.dispose()
            inputDisposableRef.current = terminal.onData(write)
            terminal.focus()
        },
        [write]
    )

    const handleResize = useCallback(
        (cols: number, rows: number) => {
            lastSizeRef.current = { cols, rows }
            if (!session?.active || !terminalSupported) {
                return
            }
            if (!connectOnceRef.current) {
                connectOnceRef.current = true
                connect(cols, rows)
            } else {
                resize(cols, rows)
            }
        },
        [session?.active, terminalSupported, connect, resize]
    )

    useEffect(() => {
        if (!session?.active || !terminalSupported) {
            return
        }
        if (connectOnceRef.current) {
            return
        }
        const size = lastSizeRef.current
        if (!size) {
            return
        }
        connectOnceRef.current = true
        connect(size.cols, size.rows)
    }, [session?.active, terminalSupported, connect])

    useEffect(() => {
        connectOnceRef.current = false
        setExitInfo(null)
        if (exitNavTimerRef.current) {
            clearTimeout(exitNavTimerRef.current)
            exitNavTimerRef.current = null
        }
        disconnect()
    }, [sessionId, disconnect])

    useEffect(() => {
        return () => {
            inputDisposableRef.current?.dispose()
            connectOnceRef.current = false
            if (exitNavTimerRef.current) {
                clearTimeout(exitNavTimerRef.current)
                exitNavTimerRef.current = null
            }
            disconnect()
        }
    }, [disconnect])

    useEffect(() => {
        if (session?.active === false || !terminalSupported) {
            disconnect()
            connectOnceRef.current = false
        }
    }, [session?.active, terminalSupported, disconnect])

    useEffect(() => {
        if (terminalState.status === 'connecting' || terminalState.status === 'connected') {
            setExitInfo(null)
            if (exitNavTimerRef.current) {
                clearTimeout(exitNavTimerRef.current)
                exitNavTimerRef.current = null
            }
        }
    }, [terminalState.status])

    const handleFullscreenToggle = useCallback(async () => {
        const page = pageRef.current
        if (!page) {
            return
        }

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen()
            } else {
                await page.requestFullscreen()
            }
        } catch {
            // Fullscreen can be denied by browser policy. Keep the terminal
            // usable and focused when that happens.
        } finally {
            terminalRef.current?.focus()
        }
    }, [])

    if (!session) {
        return (
            <div className="flex h-full items-center justify-center">
                <LoadingState label="Loading session…" className="text-sm" />
            </div>
        )
    }

    const subtitle = session.metadata?.path ?? sessionId
    const status = terminalState.status
    const errorMessage = !terminalSupported
        ? t('terminal.unsupportedWindows')
        : terminalState.status === 'error'
          ? terminalState.error
          : null

    return (
        <div
            ref={pageRef}
            className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]"
            data-testid="terminal-page"
        >
            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="flex w-full items-center gap-2 border-b border-[var(--app-border)] px-3 py-2">
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">Terminal</div>
                        <div className="truncate text-xs text-[var(--app-hint)]">{subtitle}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void handleFullscreenToggle()
                        }}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-2.5 text-xs font-medium text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-button)] sm:text-sm"
                        aria-label={isFullscreen ? t('terminal.fullscreen.exit') : t('terminal.fullscreen.enter')}
                        title={isFullscreen ? t('terminal.fullscreen.exit') : t('terminal.fullscreen.enter')}
                    >
                        <span aria-hidden="true">{isFullscreen ? '⊡' : '⛶'}</span>
                        <span>{isFullscreen ? t('terminal.fullscreen.exit') : t('terminal.fullscreen.enter')}</span>
                    </button>
                    <ConnectionIndicator status={status} />
                </div>
            </div>

            {session.active ? null : (
                <div className="px-3 pt-3">
                    <div className="w-full rounded-md bg-[var(--app-subtle-bg)] p-3 text-sm text-[var(--app-hint)]">
                        Session is inactive. Terminal is unavailable.
                    </div>
                </div>
            )}

            {errorMessage ? (
                <div className="w-full px-3 pt-3">
                    <div className="rounded-md border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-3 text-xs text-[var(--app-badge-error-text)]">
                        {errorMessage}
                    </div>
                </div>
            ) : null}

            {exitInfo ? (
                <div className="w-full px-3 pt-3">
                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">
                        Terminal exited{exitInfo.code !== null ? ` with code ${exitInfo.code}` : ''}
                        {exitInfo.signal ? ` (${exitInfo.signal})` : ''}.
                    </div>
                </div>
            ) : null}

            <div className="flex-1 min-h-0 overflow-hidden bg-[#282c34]">
                <div className="h-full w-full p-2">
                    {terminalSupported ? (
                        <TerminalView onMount={handleTerminalMount} onResize={handleResize} className="h-full w-full" />
                    ) : (
                        <div className="flex h-full items-center justify-center rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-4 text-sm text-[var(--app-hint)]">
                            {t('terminal.unsupportedWindows')}
                        </div>
                    )}
                </div>
            </div>

        </div>
    )
}

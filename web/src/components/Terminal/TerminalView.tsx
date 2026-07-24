import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { ensureBuiltinFontLoaded, getFontProvider } from '@/lib/terminalFont'
import { getInitialTerminalFontSize } from '@/hooks/useTerminalFontSize'
import { safeCopyToClipboard } from '@/lib/clipboard'

const GHOSTTY_DEFAULT_THEME = {
    background: '#282c34',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorAccent: '#282c34',
    selectionBackground: '#ffffff',
    selectionForeground: '#282c34',
    black: '#1d1f21',
    red: '#cc6666',
    green: '#b5bd68',
    yellow: '#f0c674',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#c5c8c6',
    brightBlack: '#666666',
    brightRed: '#d54e53',
    brightGreen: '#b9ca4a',
    brightYellow: '#e7c547',
    brightBlue: '#7aa6da',
    brightMagenta: '#c397d8',
    brightCyan: '#70c0b1',
    brightWhite: '#eaeaea',
}

const MAX_OSC52_BASE64_LENGTH = 4 * 1024 * 1024
const RESIZE_REPORT_DELAY_MS = 80
const WRITE_REFRESH_DELAY_MS = 50

function decodeOsc52Clipboard(data: string): string | null {
    const separator = data.indexOf(';')
    if (separator < 0) {
        return null
    }

    const selection = data.slice(0, separator)
    const payload = data.slice(separator + 1)
    if (
        !/^[cpsq0-7]*$/.test(selection) ||
        !payload ||
        payload === '?' ||
        payload.length > MAX_OSC52_BASE64_LENGTH ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
    ) {
        return null
    }

    try {
        const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
        const binary = atob(paddedPayload)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        return new TextDecoder().decode(bytes)
    } catch {
        return null
    }
}

function isTerminalCopyShortcut(event: KeyboardEvent): boolean {
    if (event.altKey || event.key.toLowerCase() !== 'c') {
        return false
    }
    const macCopy = event.metaKey && !event.ctrlKey && !event.shiftKey
    const terminalCopy = event.ctrlKey && event.shiftKey && !event.metaKey
    return macCopy || terminalCopy
}

function isTerminalPasteShortcut(event: KeyboardEvent): boolean {
    if (event.altKey || event.key.toLowerCase() !== 'v') {
        return false
    }
    const macPaste = event.metaKey && !event.ctrlKey && !event.shiftKey
    const terminalPaste = event.ctrlKey && event.shiftKey && !event.metaKey
    return macPaste || terminalPaste
}

export function TerminalView(props: {
    onMount?: (terminal: Terminal) => void
    onResize?: (cols: number, rows: number) => void
    className?: string
}) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const onMountRef = useRef(props.onMount)
    const onResizeRef = useRef(props.onResize)

    useEffect(() => {
        onMountRef.current = props.onMount
    }, [props.onMount])

    useEffect(() => {
        onResizeRef.current = props.onResize
    }, [props.onResize])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const abortController = new AbortController()

        const fontProvider = getFontProvider()
        const fontSize = getInitialTerminalFontSize()
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: fontProvider.getFontFamily(),
            fontSize,
            theme: GHOSTTY_DEFAULT_THEME,
            convertEol: true,
            customGlyphs: true,
            // zellij/tmux can enable terminal mouse reporting, which otherwise
            // prevents xterm from creating a local selection on macOS.
            macOptionClickForcesSelection: true
        })

        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.open(container)

        let fitFrame: number | null = null
        let settleFrame: number | null = null
        let refreshFrame: number | null = null
        let resizeReportTimer: number | null = null
        let writeRefreshTimer: number | null = null
        let lastReportedSize: { cols: number; rows: number } | null = null
        let webglAddon: WebglAddon | null = null
        let webglContextLossDisposable: { dispose: () => void } | null = null

        const refreshTerminal = () => {
            if (abortController.signal.aborted || terminal.rows <= 0) return
            terminal.refresh(0, terminal.rows - 1)
        }

        const scheduleRefresh = () => {
            if (refreshFrame !== null || abortController.signal.aborted) return
            refreshFrame = requestAnimationFrame(() => {
                refreshFrame = null
                refreshTerminal()
            })
        }

        const scheduleWriteRefresh = () => {
            if (writeRefreshTimer !== null) {
                window.clearTimeout(writeRefreshTimer)
            }
            writeRefreshTimer = window.setTimeout(() => {
                writeRefreshTimer = null
                scheduleRefresh()
            }, WRITE_REFRESH_DELAY_MS)
        }

        // The DOM renderer lays each styled run out as an inline span. With
        // CJK fallback fonts, subpixel width corrections can accumulate across
        // a row and visibly push fixed-column zellij/tmux borders sideways.
        // WebGL places every glyph directly on the terminal cell grid instead.
        // Fall back to DOM when WebGL2 is unavailable or its context is lost.
        try {
            const addon = new WebglAddon()
            webglAddon = addon
            webglContextLossDisposable = addon.onContextLoss(() => {
                webglContextLossDisposable?.dispose()
                webglContextLossDisposable = null
                addon.dispose()
                if (webglAddon === addon) {
                    webglAddon = null
                }
                scheduleRefresh()
            })
            terminal.loadAddon(addon)
        } catch {
            webglContextLossDisposable?.dispose()
            webglContextLossDisposable = null
            webglAddon?.dispose()
            webglAddon = null
        }

        const reportTerminalSize = () => {
            if (abortController.signal.aborted) return
            const nextSize = { cols: terminal.cols, rows: terminal.rows }
            if (
                lastReportedSize?.cols === nextSize.cols &&
                lastReportedSize.rows === nextSize.rows
            ) {
                return
            }
            const onResize = onResizeRef.current
            if (!onResize) return
            lastReportedSize = nextSize
            onResize(nextSize.cols, nextSize.rows)
        }

        const scheduleResizeReport = () => {
            if (resizeReportTimer !== null) {
                window.clearTimeout(resizeReportTimer)
            }
            resizeReportTimer = window.setTimeout(() => {
                resizeReportTimer = null
                reportTerminalSize()
            }, RESIZE_REPORT_DELAY_MS)
        }

        const fitTerminal = () => {
            if (abortController.signal.aborted) return
            fitAddon.fit()
            scheduleResizeReport()
            scheduleRefresh()
        }

        const scheduleFit = () => {
            if (fitFrame !== null) {
                cancelAnimationFrame(fitFrame)
            }
            fitFrame = requestAnimationFrame(() => {
                fitFrame = null
                fitTerminal()
            })
        }

        // Fullscreen transitions and browser chrome changes can settle one frame
        // after the first resize notification. Fit once immediately and once
        // after layout has settled so the PTY always receives the final rows/cols.
        const scheduleSettledFit = () => {
            scheduleFit()
            if (settleFrame !== null) {
                cancelAnimationFrame(settleFrame)
            }
            settleFrame = requestAnimationFrame(() => {
                settleFrame = requestAnimationFrame(() => {
                    settleFrame = null
                    scheduleFit()
                })
            })
        }

        const observer = new ResizeObserver(scheduleFit)
        observer.observe(container)
        window.addEventListener('resize', scheduleSettledFit)
        window.addEventListener('focus', scheduleSettledFit)
        document.addEventListener('fullscreenchange', scheduleSettledFit)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                scheduleSettledFit()
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        // xterm parses terminal writes asynchronously. Redraw after a short
        // quiet period so a stale frame cannot survive a zellij/tmux tab switch
        // or alternate-screen redraw without repainting every row each frame.
        const writeParsedDisposable = terminal.onWriteParsed(scheduleWriteRefresh)

        let copyRequestId = 0
        let nativeCopyRequestId = -1
        let remoteClipboardText = ''
        const handledClipboardKeyEvents = new WeakSet<KeyboardEvent>()
        const getCopyText = () => terminal.getSelection() || remoteClipboardText

        const osc52Disposable = terminal.parser.registerOscHandler(52, (data) => {
            const text = decodeOsc52Clipboard(data)
            if (text === null) {
                return false
            }

            remoteClipboardText = text
            // Do not let arbitrary terminal output overwrite the system
            // clipboard. Store the zellij/tmux selection and require the
            // user's normal Cmd-C action to copy it.
            return true
        })

        const handleNativeCopy = (event: ClipboardEvent) => {
            const selection = getCopyText()
            if (!selection || !event.clipboardData) {
                return
            }
            nativeCopyRequestId = copyRequestId
            event.clipboardData.setData('text/plain', selection)
            event.preventDefault()
            event.stopPropagation()
            terminal.focus()
        }
        const handleNativePaste = (event: ClipboardEvent) => {
            const text = event.clipboardData?.getData('text/plain') ?? ''
            if (!text) {
                return
            }
            event.preventDefault()
            event.stopImmediatePropagation()
            terminal.paste(text)
            terminal.focus()
        }
        const handleClipboardShortcutKeyDown = (event: KeyboardEvent) => {
            if (event.type !== 'keydown' || handledClipboardKeyEvents.has(event)) {
                return
            }

            if (isTerminalCopyShortcut(event)) {
                handledClipboardKeyEvents.add(event)
                const selection = getCopyText()
                if (!selection) {
                    return
                }
                const requestId = ++copyRequestId

                // Let the browser emit its native copy event first. That
                // event exposes clipboardData synchronously and works
                // without Clipboard API permission. Fall back only when
                // the browser does not emit one (for example, for
                // Ctrl-Shift-C in browsers that only recognize Cmd-C).
                window.setTimeout(() => {
                    if (
                        abortController.signal.aborted ||
                        nativeCopyRequestId === requestId
                    ) {
                        return
                    }
                    void safeCopyToClipboard(selection).catch(() => {
                        // Keep the terminal usable if clipboard access is
                        // denied by the browser.
                    })
                }, 0)
                return
            }
        }
        const handleContainerKeyDown = (event: KeyboardEvent) => {
            handleClipboardShortcutKeyDown(event)
        }
        container.addEventListener('keydown', handleContainerKeyDown, true)
        container.addEventListener('copy', handleNativeCopy, true)
        container.addEventListener('paste', handleNativePaste, true)

        terminal.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown') {
                return true
            }

            if (isTerminalCopyShortcut(event)) {
                handleClipboardShortcutKeyDown(event)
                return false
            }

            // The browser's native paste event is the single owner of paste
            // data. Reading navigator.clipboard here races that event and can
            // insert the same text twice.
            if (isTerminalPasteShortcut(event)) {
                return false
            }

            // Plain Ctrl-C and Ctrl-V remain terminal control sequences.
            return true
        })

        const refreshFont = (forceRemeasure = false) => {
            if (abortController.signal.aborted) return
            const nextFamily = fontProvider.getFontFamily()
            const refreshRendererFont = () => {
                webglAddon?.clearTextureAtlas()
                scheduleRefresh()
                scheduleFit()
            }

            if (forceRemeasure && terminal.options.fontFamily === nextFamily) {
                terminal.options.fontFamily = `${nextFamily}, "__hapi_font_refresh__"`
                requestAnimationFrame(() => {
                    if (abortController.signal.aborted) return
                    terminal.options.fontFamily = nextFamily
                    refreshRendererFont()
                })
                return
            }

            terminal.options.fontFamily = nextFamily
            refreshRendererFont()
        }

        void ensureBuiltinFontLoaded().then(loaded => {
            if (!loaded) return
            refreshFont(true)
        })

        // Cleanup on abort
        abortController.signal.addEventListener('abort', () => {
            observer.disconnect()
            window.removeEventListener('resize', scheduleSettledFit)
            window.removeEventListener('focus', scheduleSettledFit)
            document.removeEventListener('fullscreenchange', scheduleSettledFit)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            container.removeEventListener('keydown', handleContainerKeyDown, true)
            container.removeEventListener('copy', handleNativeCopy, true)
            container.removeEventListener('paste', handleNativePaste, true)
            if (fitFrame !== null) {
                cancelAnimationFrame(fitFrame)
            }
            if (settleFrame !== null) {
                cancelAnimationFrame(settleFrame)
            }
            if (refreshFrame !== null) {
                cancelAnimationFrame(refreshFrame)
            }
            if (resizeReportTimer !== null) {
                window.clearTimeout(resizeReportTimer)
            }
            if (writeRefreshTimer !== null) {
                window.clearTimeout(writeRefreshTimer)
            }
            fitAddon.dispose()
            webLinksAddon.dispose()
            webglContextLossDisposable?.dispose()
            webglAddon?.dispose()
            writeParsedDisposable.dispose()
            osc52Disposable.dispose()
            terminal.dispose()
        })

        scheduleSettledFit()
        onMountRef.current?.(terminal)

        return () => abortController.abort()
    }, [])

    return (
        <div
            ref={containerRef}
            className={`h-full w-full ${props.className ?? ''}`}
        />
    )
}

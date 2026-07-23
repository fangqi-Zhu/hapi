import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
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
        const canvasAddon = new CanvasAddon()
        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.loadAddon(canvasAddon)
        terminal.open(container)

        let fitFrame: number | null = null
        let settleFrame: number | null = null

        const fitTerminal = () => {
            if (abortController.signal.aborted) return
            fitAddon.fit()
            onResizeRef.current?.(terminal.cols, terminal.rows)
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
        document.addEventListener('fullscreenchange', scheduleSettledFit)

        let copyRequestId = 0
        let nativeCopyRequestId = -1
        let pasteRequestId = 0
        let nativePasteRequestId = -1
        const handledClipboardKeyEvents = new WeakSet<KeyboardEvent>()

        const handleNativeCopy = (event: ClipboardEvent) => {
            const selection = terminal.getSelection()
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
            nativePasteRequestId = pasteRequestId
            event.preventDefault()
            event.stopPropagation()
            terminal.paste(text)
            terminal.focus()
        }
        const handleClipboardShortcutKeyDown = (event: KeyboardEvent) => {
            if (event.type !== 'keydown' || handledClipboardKeyEvents.has(event)) {
                return
            }

            if (isTerminalCopyShortcut(event)) {
                handledClipboardKeyEvents.add(event)
                const selection = terminal.getSelection()
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

            if (isTerminalPasteShortcut(event)) {
                handledClipboardKeyEvents.add(event)
                const requestId = ++pasteRequestId

                // Keep the browser's native paste action available. It
                // carries clipboardData without requiring Clipboard API
                // permission. If no paste event arrives, fall back to
                // readText after the default action has had a chance to run.
                window.setTimeout(() => {
                    if (
                        abortController.signal.aborted ||
                        nativePasteRequestId === requestId ||
                        !navigator.clipboard?.readText
                    ) {
                        return
                    }
                    void navigator.clipboard.readText().then((text) => {
                        if (!abortController.signal.aborted && text) {
                            terminal.paste(text)
                            terminal.focus()
                        }
                    }).catch(() => {
                        // Native paste remains the permission-free fallback.
                    })
                }, 0)
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

            if (isTerminalCopyShortcut(event) || isTerminalPasteShortcut(event)) {
                handleClipboardShortcutKeyDown(event)
                return false
            }

            // Plain Ctrl-C and Ctrl-V remain terminal control sequences.
            return true
        })

        const refreshFont = (forceRemeasure = false) => {
            if (abortController.signal.aborted) return
            const nextFamily = fontProvider.getFontFamily()

            if (forceRemeasure && terminal.options.fontFamily === nextFamily) {
                terminal.options.fontFamily = `${nextFamily}, "__hapi_font_refresh__"`
                requestAnimationFrame(() => {
                    if (abortController.signal.aborted) return
                    terminal.options.fontFamily = nextFamily
                    if (terminal.rows > 0) {
                        terminal.refresh(0, terminal.rows - 1)
                    }
                    scheduleFit()
                })
                return
            }

            terminal.options.fontFamily = nextFamily
            if (terminal.rows > 0) {
                terminal.refresh(0, terminal.rows - 1)
            }
            scheduleFit()
        }

        void ensureBuiltinFontLoaded().then(loaded => {
            if (!loaded) return
            refreshFont(true)
        })

        // Cleanup on abort
        abortController.signal.addEventListener('abort', () => {
            observer.disconnect()
            window.removeEventListener('resize', scheduleSettledFit)
            document.removeEventListener('fullscreenchange', scheduleSettledFit)
            container.removeEventListener('keydown', handleContainerKeyDown, true)
            container.removeEventListener('copy', handleNativeCopy, true)
            container.removeEventListener('paste', handleNativePaste, true)
            if (fitFrame !== null) {
                cancelAnimationFrame(fitFrame)
            }
            if (settleFrame !== null) {
                cancelAnimationFrame(settleFrame)
            }
            fitAddon.dispose()
            webLinksAddon.dispose()
            canvasAddon.dispose()
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

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import { ensureBuiltinFontLoaded, getFontProvider } from '@/lib/terminalFont'
import { getInitialTerminalFontSize } from '@/hooks/useTerminalFontSize'

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
            customGlyphs: true
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

        terminal.attachCustomKeyEventHandler((event) => {
            const isCopyShortcut =
                (event.metaKey || event.ctrlKey) &&
                !event.altKey &&
                event.key.toLowerCase() === 'c'

            // Let the browser/xterm copy event handle a selected range. With no
            // selection, Ctrl-C still reaches the remote shell as SIGINT.
            if (isCopyShortcut && terminal.hasSelection()) {
                return false
            }
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

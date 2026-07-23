import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { TerminalView } from './TerminalView'

const terminalMocks = vi.hoisted(() => ({
    fit: vi.fn(),
    resizeObserverCallback: null as ResizeObserverCallback | null,
    keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
    hasSelection: vi.fn(() => false),
    terminalOptions: null as Record<string, unknown> | null,
}))

vi.mock('@xterm/xterm', () => ({
    Terminal: class {
        cols = 120
        rows = 40
        options: Record<string, unknown>

        constructor(options: Record<string, unknown>) {
            this.options = options
            terminalMocks.terminalOptions = options
        }

        loadAddon = vi.fn()
        open = vi.fn()
        write = vi.fn()
        refresh = vi.fn()
        dispose = vi.fn()
        hasSelection = terminalMocks.hasSelection

        attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
            terminalMocks.keyHandler = handler
        }
    }
}))

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: class {
        fit = terminalMocks.fit
        dispose = vi.fn()
    }
}))

vi.mock('@xterm/addon-web-links', () => ({
    WebLinksAddon: class {
        dispose = vi.fn()
    }
}))

vi.mock('@xterm/addon-canvas', () => ({
    CanvasAddon: class {
        dispose = vi.fn()
    }
}))

vi.mock('@/lib/terminalFont', () => ({
    ensureBuiltinFontLoaded: vi.fn(async () => false),
    getFontProvider: () => ({
        getFontFamily: () => 'monospace'
    })
}))

vi.mock('@/hooks/useTerminalFontSize', () => ({
    getInitialTerminalFontSize: () => 14
}))

class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
        terminalMocks.resizeObserverCallback = callback
    }

    observe() {}
    disconnect() {}
    unobserve() {}
}

describe('TerminalView resizing and copy behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        terminalMocks.keyHandler = null
        terminalMocks.resizeObserverCallback = null
        terminalMocks.terminalOptions = null
        vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('refits and reports the PTY size after fullscreen changes', async () => {
        const onResize = vi.fn()
        render(<TerminalView onResize={onResize} />)

        await waitFor(() => {
            expect(terminalMocks.fit).toHaveBeenCalled()
            expect(onResize).toHaveBeenCalledWith(120, 40)
        })
        const fitCount = terminalMocks.fit.mock.calls.length

        act(() => {
            document.dispatchEvent(new Event('fullscreenchange'))
        })

        await waitFor(() => {
            expect(terminalMocks.fit.mock.calls.length).toBeGreaterThan(fitCount)
        })
    })

    it('leaves copy shortcuts to the browser only when text is selected', async () => {
        render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.keyHandler).not.toBeNull()
        })

        terminalMocks.hasSelection.mockReturnValue(true)
        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'c', metaKey: true })
            )
        ).toBe(false)

        terminalMocks.hasSelection.mockReturnValue(false)
        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })
            )
        ).toBe(true)
    })

    it('uses the Ghostty default terminal palette', async () => {
        render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.terminalOptions).not.toBeNull()
        })

        expect(terminalMocks.terminalOptions?.theme).toMatchObject({
            background: '#282c34',
            foreground: '#ffffff',
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
        })
    })
})

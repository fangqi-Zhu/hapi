import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { TerminalView } from './TerminalView'

const terminalMocks = vi.hoisted(() => ({
    fit: vi.fn(),
    resizeObserverCallback: null as ResizeObserverCallback | null,
    keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    paste: vi.fn(),
    focus: vi.fn(),
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
        getSelection = terminalMocks.getSelection
        paste = terminalMocks.paste
        focus = terminalMocks.focus

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
        terminalMocks.hasSelection.mockReturnValue(false)
        terminalMocks.getSelection.mockReturnValue('')
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

    it('copies with Cmd-C and Ctrl-Shift-C while preserving plain Ctrl-C', async () => {
        const writeText = vi.fn(async () => undefined)
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
        })
        render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.keyHandler).not.toBeNull()
        })

        terminalMocks.hasSelection.mockReturnValue(true)
        terminalMocks.getSelection.mockReturnValue('selected output')
        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'c', metaKey: true })
            )
        ).toBe(false)
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('selected output')
        })

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })
            )
        ).toBe(true)

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true })
            )
        ).toBe(false)
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledTimes(2)
        })
    })

    it('pastes native clipboard data and falls back to clipboard readText', async () => {
        const readText = vi.fn(async () => 'fallback paste')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })
        const rendered = render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.keyHandler).not.toBeNull()
        })

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'v', metaKey: true })
            )
        ).toBe(false)

        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: { getData: () => 'native paste' }
        })
        rendered.container.firstElementChild?.dispatchEvent(pasteEvent)

        expect(terminalMocks.paste).toHaveBeenCalledWith('native paste')
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        expect(readText).not.toHaveBeenCalled()

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true })
            )
        ).toBe(false)
        await waitFor(() => {
            expect(readText).toHaveBeenCalledTimes(1)
            expect(terminalMocks.paste).toHaveBeenCalledWith('fallback paste')
        })

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'v', ctrlKey: true })
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

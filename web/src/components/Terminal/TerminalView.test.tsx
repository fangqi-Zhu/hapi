import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { TerminalView } from './TerminalView'

const terminalMocks = vi.hoisted(() => ({
    fit: vi.fn(),
    resizeObserverCallback: null as ResizeObserverCallback | null,
    writeParsedCallback: null as (() => void) | null,
    writeParsedDispose: vi.fn(),
    keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
    oscHandler: null as ((data: string) => boolean | Promise<boolean>) | null,
    oscDispose: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ''),
    paste: vi.fn(),
    focus: vi.fn(),
    refresh: vi.fn(),
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
        refresh = terminalMocks.refresh
        dispose = vi.fn()
        hasSelection = terminalMocks.hasSelection
        getSelection = terminalMocks.getSelection
        paste = terminalMocks.paste
        focus = terminalMocks.focus
        parser = {
            registerOscHandler: (
                ident: number,
                handler: (data: string) => boolean | Promise<boolean>
            ) => {
                if (ident === 52) {
                    terminalMocks.oscHandler = handler
                }
                return { dispose: terminalMocks.oscDispose }
            }
        }

        attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
            terminalMocks.keyHandler = handler
        }

        onWriteParsed(handler: () => void) {
            terminalMocks.writeParsedCallback = handler
            return { dispose: terminalMocks.writeParsedDispose }
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
        terminalMocks.oscHandler = null
        terminalMocks.resizeObserverCallback = null
        terminalMocks.writeParsedCallback = null
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

    it('deduplicates unchanged PTY resize reports', async () => {
        const onResize = vi.fn()
        render(<TerminalView onResize={onResize} />)

        await waitFor(() => {
            expect(onResize).toHaveBeenCalledTimes(1)
        })

        act(() => {
            terminalMocks.resizeObserverCallback?.([], {} as ResizeObserver)
            window.dispatchEvent(new Event('resize'))
        })

        await new Promise((resolve) => window.setTimeout(resolve, 150))
        expect(onResize).toHaveBeenCalledTimes(1)
    })

    it('fully refreshes after parsed output and when the page becomes visible', async () => {
        render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.writeParsedCallback).not.toBeNull()
            expect(terminalMocks.refresh).toHaveBeenCalled()
        })
        const refreshCountAfterMount = terminalMocks.refresh.mock.calls.length

        act(() => {
            terminalMocks.writeParsedCallback?.()
        })

        await waitFor(() => {
            expect(terminalMocks.refresh.mock.calls.length).toBeGreaterThan(
                refreshCountAfterMount
            )
        })
        const refreshCountAfterWrite = terminalMocks.refresh.mock.calls.length
        const fitCountAfterWrite = terminalMocks.fit.mock.calls.length

        act(() => {
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await waitFor(() => {
            expect(terminalMocks.fit.mock.calls.length).toBeGreaterThan(fitCountAfterWrite)
            expect(terminalMocks.refresh.mock.calls.length).toBeGreaterThan(
                refreshCountAfterWrite
            )
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

    it('writes an xterm selection through the native copy event', async () => {
        const rendered = render(<TerminalView />)
        terminalMocks.getSelection.mockReturnValue('native selected output')
        const setData = vi.fn()
        const copyEvent = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(copyEvent, 'clipboardData', {
            value: { setData }
        })

        rendered.container.firstElementChild?.dispatchEvent(copyEvent)

        expect(setData).toHaveBeenCalledWith('text/plain', 'native selected output')
        expect(copyEvent.defaultPrevented).toBe(true)
        expect(terminalMocks.focus).toHaveBeenCalled()
    })

    it('copies zellij OSC52 selections and reuses them for Cmd-C', async () => {
        const rendered = render(<TerminalView />)

        await waitFor(() => {
            expect(terminalMocks.oscHandler).not.toBeNull()
        })

        const selection = 'selected directly in zellij：中文'
        const encodedSelection = btoa(
            String.fromCharCode(...new TextEncoder().encode(selection))
        )
        expect(
            await terminalMocks.oscHandler?.(`c;${encodedSelection}`)
        ).toBe(true)

        const setData = vi.fn()
        const copyEvent = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(copyEvent, 'clipboardData', {
            value: { setData }
        })
        rendered.container.firstElementChild?.dispatchEvent(copyEvent)

        expect(setData).toHaveBeenCalledWith('text/plain', selection)
        expect(copyEvent.defaultPrevented).toBe(true)
    })

    it('pastes each native clipboard event exactly once', async () => {
        const readText = vi.fn(async () => 'must not be used')
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
        const secondPasteEvent = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(secondPasteEvent, 'clipboardData', {
            value: { getData: () => 'second native paste' }
        })
        rendered.container.firstElementChild?.dispatchEvent(secondPasteEvent)

        expect(terminalMocks.paste).toHaveBeenNthCalledWith(2, 'second native paste')
        expect(readText).not.toHaveBeenCalled()

        expect(
            terminalMocks.keyHandler?.(
                new KeyboardEvent('keydown', { key: 'v', ctrlKey: true })
            )
        ).toBe(true)
    })

    it('waits for native paste when xterm skips its key callback', async () => {
        const readText = vi.fn(async () => 'must not be used')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText }
        })
        const rendered = render(<TerminalView />)

        rendered.container.firstElementChild?.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'v',
                metaKey: true,
                bubbles: true,
                cancelable: true
            })
        )

        await new Promise((resolve) => window.setTimeout(resolve, 0))
        expect(readText).not.toHaveBeenCalled()
        expect(terminalMocks.paste).not.toHaveBeenCalled()

        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: { getData: () => 'container native paste' }
        })
        rendered.container.firstElementChild?.dispatchEvent(pasteEvent)

        expect(terminalMocks.paste).toHaveBeenCalledTimes(1)
        expect(terminalMocks.paste).toHaveBeenCalledWith('container native paste')
    })

    it('does not paste twice when the native paste event arrives after the shortcut', async () => {
        const text = 'paste exactly once'
        const readText = vi.fn(async () => text)
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
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        expect(readText).not.toHaveBeenCalled()
        expect(terminalMocks.paste).not.toHaveBeenCalled()

        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: { getData: () => text }
        })
        rendered.container.firstElementChild?.dispatchEvent(pasteEvent)

        expect(terminalMocks.paste).toHaveBeenCalledTimes(1)
        expect(terminalMocks.paste).toHaveBeenCalledWith(text)
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
        expect(terminalMocks.terminalOptions?.macOptionClickForcesSelection).toBe(true)
    })
})

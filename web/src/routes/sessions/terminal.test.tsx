import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import TerminalPage from './terminal'

const writeMock = vi.fn()
const goBackMock = vi.fn()
const connectMock = vi.fn()
const resizeMock = vi.fn()
const disconnectMock = vi.fn()
const onOutputMock = vi.fn()
let onExitHandler: ((code: number | null, signal: string | null) => void) | null = null

const onExitRegister = (handler: (code: number | null, signal: string | null) => void) => {
    onExitHandler = handler
}

const terminalSocketState = {
    state: { status: 'connected' as const },
    connect: connectMock,
    write: writeMock,
    resize: resizeMock,
    disconnect: disconnectMock,
    onOutput: onOutputMock,
    onExit: onExitRegister
}

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ sessionId: 'session-1' })
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: null,
        token: 'test-token',
        baseUrl: 'http://localhost:3000'
    })
}))

vi.mock('@/hooks/useAppGoBack', () => ({
    useAppGoBack: () => goBackMock
}))

vi.mock('@/hooks/queries/useSession', () => ({
    useSession: () => ({
        session: {
            id: 'session-1',
            active: true,
            metadata: { path: '/tmp/project' }
        }
    })
}))

vi.mock('@/hooks/useTerminalSocket', () => ({
    useTerminalSocket: () => terminalSocketState
}))

vi.mock('@/components/Terminal/TerminalView', () => ({
    TerminalView: () => <div data-testid="terminal-view" />
}))

function renderWithProviders() {
    return render(
        <I18nProvider>
            <TerminalPage />
        </I18nProvider>
    )
}

describe('TerminalPage controls', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        onExitHandler = null
    })

    it('does not render the bottom paste and quick-input button bar', () => {
        renderWithProviders()

        expect(screen.queryByRole('button', { name: 'Paste' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Escape' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Control' })).not.toBeInTheDocument()
    })
})

describe('TerminalPage exit behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        onExitHandler = null
    })

    it('navigates back to chat shortly after the terminal exits', async () => {
        renderWithProviders()

        await waitFor(() => {
            expect(onExitHandler).not.toBeNull()
        })

        await act(async () => {
            onExitHandler?.(0, null)
        })

        await waitFor(
            () => {
                expect(goBackMock).toHaveBeenCalledTimes(1)
            },
            { timeout: 3000 }
        )
    })
})

describe('TerminalPage fullscreen behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        onExitHandler = null
    })

    it('enters and exits fullscreen from the terminal header', async () => {
        let fullscreenElement: Element | null = null
        const requestFullscreen = vi.fn(async function (this: HTMLElement) {
            fullscreenElement = this
            document.dispatchEvent(new Event('fullscreenchange'))
        })
        const exitFullscreen = vi.fn(async () => {
            fullscreenElement = null
            document.dispatchEvent(new Event('fullscreenchange'))
        })

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        })
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
            configurable: true,
            value: requestFullscreen,
        })
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        })

        renderWithProviders()

        fireEvent.click(screen.getByRole('button', { name: 'Enter full screen' }))
        await waitFor(() => {
            expect(requestFullscreen).toHaveBeenCalledTimes(1)
            expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument()
        })

        fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
        await waitFor(() => {
            expect(exitFullscreen).toHaveBeenCalledTimes(1)
            expect(screen.getByRole('button', { name: 'Enter full screen' })).toBeInTheDocument()
        })
    })

    it('does not constrain the terminal viewport to the chat content width', () => {
        renderWithProviders()

        const terminalViewport = screen.getByTestId('terminal-view').parentElement
        expect(terminalViewport).not.toBeNull()
        expect(terminalViewport?.className).not.toContain('max-w-content')
    })
})

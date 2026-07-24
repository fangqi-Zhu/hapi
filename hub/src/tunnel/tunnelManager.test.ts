import { describe, expect, it, mock } from 'bun:test'
import { type spawn } from 'bun'

import { TunnelManager } from './tunnelManager'

function createControllableStream(): {
    stream: ReadableStream<Uint8Array>
    write: (text: string) => void
    close: () => void
} {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
        start(nextController) {
            controller = nextController
        }
    })
    return {
        stream,
        write: (text) => controller?.enqueue(new TextEncoder().encode(text)),
        close: () => controller?.close()
    }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error('Timed out waiting for condition')
        }
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

describe('TunnelManager relay recovery', () => {
    it('stops a hung tunwg process after its relay connection fails', async () => {
        const stdout = createControllableStream()
        const stderr = createControllableStream()
        let resolveExit!: (exitCode: number) => void
        const exited = new Promise<number>((resolve) => {
            resolveExit = resolve
        })
        const kill = mock(() => {
            stdout.close()
            stderr.close()
            resolveExit(0)
        })

        const spawnProcess = mock(() => ({
            stdout: stdout.stream,
            stderr: stderr.stream,
            exited,
            kill
        })) as unknown as typeof spawn

        const manager = new TunnelManager({
            localPort: 3006,
            enabled: true
        }, spawnProcess)
        const started = manager.start()
        stdout.write('{"event":"ready","url":"https://test.relay.hapi.run"}\n')
        await expect(started).resolves.toBe('https://test.relay.hapi.run')

        stderr.write('temporary diagnostic line\n')
        await Promise.resolve()
        expect(kill).toHaveBeenCalledTimes(0)

        stderr.write('client relay error: read tcp: connection reset by peer\n')
        await waitUntil(() => kill.mock.calls.length === 1)
        expect(kill).toHaveBeenCalledTimes(1)
        await manager.stop()
    })
})

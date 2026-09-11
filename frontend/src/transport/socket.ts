import type { ClientEvent, ServerEvent } from '@/types/protocol'

type EventHandler = (event: ServerEvent) => void
type StateHandler = (state: 'idle' | 'connecting' | 'online' | 'offline', detail?: string) => void

/**
 * Thin WebSocket client for the agent backend.
 *
 * It deliberately does nothing when there is no backend: the UI shows an
 * offline state rather than pretending a command was carried out.
 */
class AgentSocket {
  private ws: WebSocket | null = null
  private url = ''
  private shouldReconnect = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  onEvent: EventHandler = () => {}
  onState: StateHandler = () => {}

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(url: string) {
    this.url = url
    this.shouldReconnect = true
    this.attempt = 0
    this.open()
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.ws?.close()
    this.ws = null
    this.onState('idle')
  }

  send(event: ClientEvent): boolean {
    if (!this.isOpen) return false
    this.ws!.send(JSON.stringify(event))
    return true
  }

  private open() {
    if (this.timer) clearTimeout(this.timer)
    try {
      this.onState('connecting')
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.attempt = 0
        this.onState('online')
      }

      ws.onmessage = (raw) => {
        try {
          this.onEvent(JSON.parse(raw.data as string) as ServerEvent)
        } catch {
          // A malformed frame is a backend bug, not something to surface as
          // assistant output.
          console.warn('[paradox] dropped malformed frame')
        }
      }

      ws.onerror = () => {
        /* handled by onclose */
      }

      ws.onclose = () => {
        this.ws = null
        this.onState('offline')
        if (this.shouldReconnect) this.scheduleReconnect()
      }
    } catch (err) {
      this.onState('offline', String(err))
      if (this.shouldReconnect) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    this.attempt += 1
    const delay = Math.min(15_000, 800 * 2 ** Math.min(this.attempt, 5))
    this.timer = setTimeout(() => this.open(), delay)
  }
}

export const agentSocket = new AgentSocket()

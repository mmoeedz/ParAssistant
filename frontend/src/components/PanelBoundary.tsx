import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useSession } from '@/store/session'

/**
 * Contains a render error to the panel it happened in.
 *
 * Without this, one exception anywhere in the tree unmounted the whole app —
 * the approval dialog included, which is the one thing that must never
 * disappear while the agent is waiting on it. A crashed panel shows a short
 * notice with a retry instead, and everything around it keeps working.
 */
interface Props {
  /** Shown in the notice and the console: "Agent Town", "Console"... */
  name: string
  children: ReactNode
  /** Render nothing on failure instead of the notice (overlays). */
  silent?: boolean
}

interface State {
  error: Error | null
}

export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[paradox] ${this.props.name} crashed`, error, info.componentStack)
    try {
      useSession.getState().log('error', 'ui', `${this.props.name} crashed: ${error.message}`)
    } catch {
      /* the store itself may be what broke */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.silent) return null
    return (
      <section className="panel panel-crash" role="alert">
        <strong>{this.props.name} hit an error and was paused.</strong>
        <span>The rest of Paradox is unaffected. {this.state.error.message}</span>
        <button type="button" className="btn btn--subtle btn--sm" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </section>
    )
  }
}

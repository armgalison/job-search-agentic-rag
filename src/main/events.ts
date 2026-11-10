import type { AppEvent } from '@shared/types'

/** App-wide event bus to the main window, so lower layers (AI, usage) can notify the UI. */
let sink: (e: AppEvent) => void = () => {}

export function setEventSink(fn: (e: AppEvent) => void): void {
  sink = fn
}

export function emit(e: AppEvent): void {
  sink(e)
}

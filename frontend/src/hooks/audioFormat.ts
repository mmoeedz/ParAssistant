/**
 * The mime type push-to-talk records in. Pinned explicitly (rather than
 * leaving it to MediaRecorder's default) because the backend hands these
 * chunks to the transcriber as WebM/Opus — a browser that defaulted to
 * something else would silently break transcription.
 */
export const RECORDER_MIME_TYPE = 'audio/webm;codecs=opus'

/** Plenty for speech; Chrome's default is 128 kbit/s, four times the upload. */
const SPEECH_BITRATE = 32_000

export function recorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(RECORDER_MIME_TYPE)) {
    return { mimeType: RECORDER_MIME_TYPE, audioBitsPerSecond: SPEECH_BITRATE }
  }
  // No browser we support should hit this, but better a default-format
  // recording than none — the backend will just fail that one transcription.
  return undefined
}

/** Microphone constraints shared by push-to-talk and always-listening. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
}

/** Base64 of raw bytes, in slices: appending one character per byte is
 *  slow, and spreading the whole buffer at once can blow the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const SLICE = 0x8000
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE))
  }
  return btoa(binary)
}

/** The user-facing reason getUserMedia failed. */
export function micErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return 'Microphone access was blocked. Allow it for this page (the icon at the left of the address bar), then try again.'
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      return 'No microphone was found. Plug one in, or pick an input device in Windows sound settings.'
    }
    if (err.name === 'NotReadableError' || err.name === 'AbortError') {
      return 'The microphone is in use by another app or was switched off at the hardware level.'
    }
  }
  return 'Could not open the microphone.'
}

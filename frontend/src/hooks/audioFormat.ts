/**
 * The mime type both mic hooks record in. Pinned explicitly (rather than
 * leaving it to MediaRecorder's default) because the backend streams these
 * chunks straight to Google Speech-to-Text as WEBM_OPUS — a browser that
 * defaulted to something else would silently break transcription.
 */
export const RECORDER_MIME_TYPE = 'audio/webm;codecs=opus'

export function recorderOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(RECORDER_MIME_TYPE)) {
    return { mimeType: RECORDER_MIME_TYPE }
  }
  // No browser we support should hit this, but better a default-format
  // recording than none — the backend will just fail that one transcription.
  return undefined
}

// Recordings stored on Vapi (storage.vapi.ai) are gone: Vapi was decommissioned
// and that host no longer resolves. Players show a plain notice for those links
// instead of a control that can never play.
export function isRecordingGone(url) {
  if (!url) return true
  try {
    return new URL(url).hostname === 'storage.vapi.ai'
  } catch {
    return true
  }
}

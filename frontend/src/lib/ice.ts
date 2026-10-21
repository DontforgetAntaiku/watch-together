/**
 * STUN lets two browsers find each other's public address; the video itself then flows directly between them.
 * To use your own servers (a TURN server helps on strict networks) build with
 * VITE_ICE_SERVERS='[{"urls":"turn:turn.example.com","username":"u","credential":"p"}]'.
 */
function load(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS
  if (raw) {
    try {
      return JSON.parse(raw) as RTCIceServer[]
    } catch {
      /* fall through to the default */
    }
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

export const ICE_SERVERS = load()

import { useEffect, useRef, useState } from 'react'
import './RoomCode.css'

type Props = { code: string }

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

export function RoomCode({ code }: Props) {
  const [done, setDone] = useState<'code' | 'link' | 'fail' | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const link = `${window.location.origin}/r/${code}`

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flash = (value: 'code' | 'link' | 'fail') => {
    setDone(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(null), 1800)
  }

  const run = async (kind: 'code' | 'link') => flash((await copy(kind === 'code' ? code : link)) ? kind : 'fail')

  const share = async () => {
    try {
      await navigator.share({ title: 'Watch Together', text: `Join my room ${code}`, url: link })
    } catch {
      /* the sheet was dismissed */
    }
  }

  return (
    <div className="ticket">
      <div className="ticket__stub">
        <span className="ticket__label">Room</span>
        <span className="ticket__code" aria-label={`Room code ${code.split('').join(' ')}`}>
          {code}
        </span>
      </div>
      <div className="ticket__actions">
        {canShare && (
          <button type="button" className="btn btn--primary ticket__btn" onClick={share}>
            Invite friends
          </button>
        )}
        <button type="button" className="btn ticket__btn" onClick={() => run('link')}>
          {done === 'link' ? 'Link copied' : done === 'fail' ? 'Copy failed' : 'Copy link'}
        </button>
        <button type="button" className="btn ticket__btn" onClick={() => run('code')}>
          {done === 'code' ? 'Code copied' : 'Copy code'}
        </button>
      </div>
    </div>
  )
}

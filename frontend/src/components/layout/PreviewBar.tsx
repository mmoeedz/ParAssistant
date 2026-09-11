import { TriangleAlert } from 'lucide-react'
import { useSession } from '@/store/session'
import { Button } from '@/components/ui'
import './layout.css'

/**
 * Unmissable marker for preview mode. Rule 31 of the spec: never let the UI
 * imply an action happened when it did not.
 */
export function PreviewBar() {
  const preview = useSession((s) => s.preview)
  const setPreview = useSession((s) => s.setPreview)
  if (!preview) return null

  return (
    <div className="previewbar" role="status">
      <TriangleAlert size={15} />
      <span className="previewbar__text">
        Preview data — this is a scripted sample of the interface. No app is opened, no message is
        sent, nothing on this computer is touched.
      </span>
      <Button size="sm" onClick={() => setPreview(false)}>
        Exit preview
      </Button>
    </div>
  )
}

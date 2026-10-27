import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Actions keep their component state and handlers while occupying the design's fixed bar.
export const DockFooterTarget = createContext<HTMLElement | null | undefined>(
  undefined,
)

export function DockFooter({ children }: { children: ReactNode }) {
  const target = useContext(DockFooterTarget)
  if (target === undefined)
    return <div className="dock-inline-actions">{children}</div>
  return target ? createPortal(children, target) : null
}

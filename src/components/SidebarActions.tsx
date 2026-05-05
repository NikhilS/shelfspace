import React from 'react';
import {createPortal} from 'react-dom';

interface SidebarActionsProps {
  children: React.ReactNode;
}

export default function SidebarActions({children}: SidebarActionsProps) {
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setMountNode(document.getElementById('sidebar-actions-root'));
  }, []);

  if (!mountNode || !children) {
    return null;
  }

  return createPortal(
    <div className="mt-6 flex flex-col gap-2">
      <div className="px-4 font-label-caps text-label-caps text-on-surface-variant tracking-[0.2em] mb-2 mt-2">
        Actions
      </div>
      {children}
    </div>,
    mountNode,
  );
}

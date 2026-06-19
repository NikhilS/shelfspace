import React from 'react';
import {createPortal} from 'react-dom';

interface SidebarBottomActionsProps {
  children: React.ReactNode;
}

export default function SidebarBottomActions({
  children,
}: SidebarBottomActionsProps) {
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setMountNode(document.getElementById('sidebar-bottom-actions-root'));
  }, []);

  if (!mountNode || !children) {
    return null;
  }

  return createPortal(<>{children}</>, mountNode);
}

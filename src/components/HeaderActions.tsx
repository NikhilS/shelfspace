import React from 'react';
import {createPortal} from 'react-dom';

interface HeaderActionsProps {
  children: React.ReactNode;
}

export default function HeaderActions({children}: HeaderActionsProps) {
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setMountNode(document.getElementById('header-actions-root'));
  }, []);

  if (!mountNode || !children) {
    return null;
  }

  return createPortal(children, mountNode);
}

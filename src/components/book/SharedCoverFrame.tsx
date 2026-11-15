import React from 'react';
import {motion} from 'motion/react';
import {
  ARCHIVAL_COVER_SPRING,
  prefersReducedMotion,
  useCoverTransitionStore,
  useShelfCoverLayoutId,
  type CoverSurfaceId,
} from '../../stores/coverTransitionStore';

export interface SharedCoverFrameProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'
> {
  surface: CoverSurfaceId;
  libraryId?: string;
  bookId?: string;
  children?: React.ReactNode;
}

/**
 * Lightweight shared-element cover slot wrapper for shelf views.
 * Renders a plain `<div>` with zero Motion overhead for all inactive items,
 * and upgrades ONLY the active `(surface, libraryId, bookId)` slot to a
 * Framer Motion `layoutId` node during forward and reverse cover flights.
 */
export function SharedCoverFrame({
  surface,
  libraryId,
  bookId,
  className,
  style,
  children,
  ...rest
}: SharedCoverFrameProps) {
  const layoutId = useShelfCoverLayoutId(surface, libraryId, bookId);

  if (!layoutId || prefersReducedMotion()) {
    return (
      <div className={className} style={style} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      layoutId={layoutId}
      transition={ARCHIVAL_COVER_SPRING}
      onLayoutAnimationComplete={() => {
        const current = useCoverTransitionStore.getState().activeTransition;
        if (current?.phase === 'to-shelf') {
          useCoverTransitionStore.getState().completeCoverTransition();
        }
      }}
      className={className}
      style={{
        ...style,
        zIndex: 30,
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

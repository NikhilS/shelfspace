import React, {useCallback} from 'react';
import {Link} from 'react-router-dom';
import {Book, User, Users, Shield} from 'lucide-react';
import {motion} from 'motion/react';
import {Library} from '../../types';
import {toTitleCase} from '../../lib/utils';
import {useAuth} from '../../stores/authStore';
import {useQueryClient} from '@tanstack/react-query';
import {trpc} from '../../lib/trpc';

interface LibraryCardProps {
  lib: Library;
  index: number;
}

export function LibraryCard({lib, index}: LibraryCardProps) {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();

  const handleWarmup = useCallback(() => {
    // Pre-seed tRPC Query cache for instant access check and header rendering
    if (lib.id) {
      utils.library.get.setData(
        {libraryId: lib.id},
        lib as unknown as NonNullable<
          ReturnType<typeof utils.library.get.getData>
        >,
      );
    }
    if (user) {
      const email = user.email?.toLowerCase();
      const role =
        lib.callerRole ||
        (lib.ownerId === user.uid
          ? 'owner'
          : (email && lib.access?.[email]) ||
            (email && lib.access?.[user.email || '']) ||
            'viewer');
      queryClient.setQueryData(
        ['libraryPermissions', lib.id, user.uid, email],
        role,
      );
    }
  }, [lib, user, utils, queryClient]);

  const isOwner = lib.ownershipType === 'owned' || lib.ownerId === user?.uid;
  const isGlobalAdmin =
    lib.ownershipType === 'global_admin' ||
    (!isOwner && lib.callerRole === 'admin');
  const isShared = !isOwner && !isGlobalAdmin;

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{
        duration: 0.4,
        delay: index * 0.05,
        ease: 'easeOut',
      }}
      className="h-full"
    >
      <Link
        to={`/library/${lib.id}`}
        className="block h-full group"
        onMouseEnter={handleWarmup}
        onTouchStart={handleWarmup}
        onFocus={handleWarmup}
      >
        <div className="bg-surface-container-low rounded-lg overflow-hidden border border-transparent shadow-elevation-3 hover:shadow-elevation-3 hover:border-outline-variant/30 transition-all duration-300 flex flex-col h-full cursor-pointer">
          <div className="h-44 w-full overflow-hidden bg-surface-variant relative">
            {lib.heroImageUrl ? (
              <img
                alt={lib.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                src={lib.heroImageUrl}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surface-container">
                <Book className="w-12 h-12 text-on-surface-variant opacity-70 group-hover:scale-110 transition-transform duration-500" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-primary/10 to-transparent mix-blend-multiply opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            {/* Top Badge */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 shadow-sm">
              {isOwner && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-primary/90 text-on-primary backdrop-blur-md border border-primary/20">
                  <User className="w-3 h-3" />
                  Owner
                </span>
              )}
              {isShared && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-surface-container-highest/95 text-on-surface backdrop-blur-md border border-outline-variant/40">
                  <Users className="w-3 h-3 text-primary" />
                  Shared ({toTitleCase(lib.callerRole || 'viewer')})
                </span>
              )}
              {isGlobalAdmin && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/90 text-white backdrop-blur-md border border-amber-600/30">
                  <Shield className="w-3 h-3" />
                  Admin View
                </span>
              )}
            </div>
          </div>

          <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
            <div className="flex items-start justify-between">
              <h3 className="font-headline-md text-headline-md text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                {toTitleCase(lib.name)}
              </h3>
            </div>

            <div className="flex items-center justify-between mt-6">
              <div className="flex items-center gap-2 text-on-surface-variant flex-shrink-0">
                <Book className="w-4 h-4" />
                <span className="font-label-caps text-label-caps uppercase tracking-wider">
                  {lib.bookCount || 0} Volumes
                </span>
              </div>

              {!isOwner && (
                <div className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant px-2 py-1 bg-surface-container rounded-sm border border-outline-variant/50 truncate max-w-[130px]">
                  By {toTitleCase(lib.ownerName || 'User')}
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

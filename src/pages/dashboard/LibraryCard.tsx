import React, {useCallback, useRef, useState, useEffect} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {Book, User, Users, Shield, ArrowUpRight} from 'lucide-react';
import {Library} from '../../types';
import {toTitleCase} from '../../lib/utils';
import {useAuth} from '../../stores/authStore';
import {useQueryClient} from '@tanstack/react-query';
import {trpc} from '../../lib/trpc';
import {Badge} from '@/components/ui/badge';
import {preloadRouteChunk} from '../../lib/routePreload';

interface LibraryCardProps {
  lib: Library;
  index: number;
}

export function LibraryCard({lib, index}: LibraryCardProps) {
  const {user} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const [heroError, setHeroError] = useState(false);

  useEffect(() => {
    setHeroError(false);
  }, [lib.heroImageUrl]);

  const seedLibraryCache = useCallback(() => {
    const currentUtils = utilsRef.current;
    if (lib.id && currentUtils?.library?.get?.setData) {
      const normalizedRole =
        lib.callerRole === 'admin' ? 'owner' : lib.callerRole;
      const isOwner =
        normalizedRole === 'owner' ||
        lib.ownershipType === 'owned' ||
        (Boolean(user?.uid) && lib.ownerId === user?.uid);
      const canEdit = isOwner || normalizedRole === 'editor';

      currentUtils.library.get.setData({libraryId: lib.id}, {
        ...lib,
        isOwner,
        canEdit,
      } as unknown as NonNullable<
        ReturnType<typeof currentUtils.library.get.getData>
      >);
    }
    if (lib.id && user) {
      const email = user.email?.toLowerCase();
      const rawRole =
        lib.callerRole ||
        (lib.ownerId === user.uid
          ? 'owner'
          : (email && lib.access?.[email]) ||
            (email && lib.access?.[user.email || '']) ||
            'viewer');
      const role = rawRole === 'admin' ? 'owner' : rawRole;
      queryClient.setQueryData(
        ['libraryPermissions', lib.id, user.uid, email],
        role,
      );
    }
  }, [lib, user, queryClient]);

  const handleMouseEnter = useCallback(() => {
    preloadRouteChunk('library');
    const isOnline =
      typeof navigator === 'undefined' || navigator.onLine !== false;
    const currentUtils = utilsRef.current;
    if (isOnline && lib.id && currentUtils?.book?.list?.prefetch) {
      void currentUtils.book.list.prefetch(
        {libraryId: lib.id},
        {staleTime: 1000 * 60 * 5},
      );
    }
  }, [lib.id]);

  const targetPath = `/library/${encodeURIComponent(lib.id)}`;

  const handleCardClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!lib.id) {
        e.preventDefault();
        return;
      }
      seedLibraryCache();
      const isOnline =
        typeof navigator === 'undefined' || navigator.onLine !== false;
      const currentUtils = utilsRef.current;
      if (isOnline && currentUtils?.book?.list?.prefetch) {
        void currentUtils.book.list.prefetch(
          {libraryId: lib.id},
          {staleTime: 1000 * 60 * 5},
        );
      }
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        (typeof e.button === 'number' && e.button !== 0)
      ) {
        return;
      }
      e.preventDefault();
      void navigate(targetPath);
    },
    [lib.id, navigate, seedLibraryCache, targetPath],
  );

  const isOwner = lib.ownershipType === 'owned' || lib.ownerId === user?.uid;
  const isGlobalAdmin =
    lib.ownershipType === 'global_admin' ||
    (!isOwner && lib.callerRole === 'admin');
  const isShared = !isOwner && !isGlobalAdmin;

  return (
    <div className="h-full" data-card-index={index}>
      <Link
        to={targetPath}
        className="block h-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-xl"
        onMouseEnter={handleMouseEnter}
        onClick={handleCardClick}
      >
        <article className="bento-card-interactive overflow-hidden flex flex-col h-full cursor-pointer">
          {/* Compact Bento Media Showcase Frame */}
          <div className="h-28 sm:h-32 w-full overflow-hidden bg-surface-container relative border-b border-outline-variant/50">
            {lib.heroImageUrl && !heroError ? (
              <img
                alt={lib.name}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                src={lib.heroImageUrl}
                onError={() => setHeroError(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-surface-container via-surface-container-high/60 to-surface-container-highest/40 p-4 text-center">
                <div className="w-9 h-9 rounded-lg bg-surface/80 border border-outline-variant/60 flex items-center justify-center mb-1.5 shadow-2xs">
                  <Book className="w-4 h-4 text-primary/75" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/80">
                  Archival Collection · Vol.{' '}
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300" />

            {/* Curatorial Role Tag */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
              {isOwner && (
                <Badge
                  variant="default"
                  size="sm"
                  className="gap-1 bg-primary/90 text-on-primary backdrop-blur-md border-white/10 shadow-xs"
                >
                  <User className="w-3 h-3" />
                  Owner
                </Badge>
              )}
              {isShared && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="gap-1 bg-surface/95 text-on-surface backdrop-blur-md border-outline-variant/60 shadow-xs"
                >
                  <Users className="w-3 h-3 text-primary" />
                  Shared ({toTitleCase(lib.callerRole || 'viewer')})
                </Badge>
              )}
              {isGlobalAdmin && (
                <Badge
                  variant="default"
                  size="sm"
                  className="gap-1 bg-tertiary text-on-tertiary backdrop-blur-md border-white/15 shadow-xs"
                >
                  <Shield className="w-3 h-3" />
                  Admin View
                </Badge>
              )}
            </div>
          </div>

          {/* Bento Editorial Details */}
          <div className="p-4 flex flex-col flex-grow justify-between bg-surface">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="metadata-eyebrow block mb-0.5">
                  {isOwner
                    ? 'Personal Archive'
                    : `Curated by ${toTitleCase(lib.ownerName || 'Archivist')}`}
                </span>
                <h3 className="font-serif text-lg font-semibold tracking-tight text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                  {toTitleCase(lib.name)}
                </h3>
              </div>
              <div className="w-7 h-7 rounded-lg border border-outline-variant/60 bg-surface-container-low flex items-center justify-center text-on-surface-variant group-hover:bg-primary group-hover:text-on-primary group-hover:border-primary transition-all shrink-0 mt-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 mt-3.5 border-t border-outline-variant/50 text-xs text-on-surface-variant">
              <div className="flex items-center gap-1.5 font-mono tabular-nums font-semibold text-on-surface">
                <Book className="w-3.5 h-3.5 text-on-surface-variant" />
                <span>{lib.bookCount || 0} Volumes</span>
              </div>

              <span className="font-sans text-xs text-on-surface-variant truncate max-w-[160px]">
                {isOwner
                  ? 'Full curatorial access'
                  : `By ${toTitleCase(lib.ownerName || 'User')}`}
              </span>
            </div>
          </div>
        </article>
      </Link>
    </div>
  );
}

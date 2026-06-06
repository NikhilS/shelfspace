import React from 'react';
import SidebarActions from './SidebarActions';
import {BookLoader} from './BookLoader';

interface PageLoadingProps {
  title?: string;
  subtitle?: string;
}

export function PageLoading({
  title = 'Opening the vaults...',
  subtitle = 'Fetching catalog, blowing off dust, and retrieving history.',
}: PageLoadingProps) {
  return (
    <>
      <SidebarActions>
        <></>
      </SidebarActions>
      <div className="flex-grow flex flex-col items-center justify-center min-h-[80vh] w-full bg-background relative overflow-hidden">
        <div className="flex flex-col items-center justify-center p-12 max-w-sm text-center">
          <BookLoader size="lg" className="mb-8" />
          <h2 className="font-serif text-2xl font-medium text-primary mb-2 italic tracking-tight">
            {title}
          </h2>
          <p className="font-body-md text-on-surface-variant text-sm max-w-xs leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>
    </>
  );
}

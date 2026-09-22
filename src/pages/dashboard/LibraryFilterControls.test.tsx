import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {LibraryFilterControls} from './LibraryFilterControls';

describe('LibraryFilterControls', () => {
  it('renders chips on 1 line without the "Filter Catalog" text', () => {
    const onToggleScope = vi.fn();
    render(
      <LibraryFilterControls
        scopes={['owned']}
        onToggleScope={onToggleScope}
        isAdmin={true}
        totalCount={5}
      />
    );

    // Verify "Filter Catalog" is dropped
    expect(screen.queryByText(/Filter Catalog/i)).not.toBeInTheDocument();

    // Verify all 3 chips are present
    const ownedBtn = screen.getByRole('button', {name: /My Libraries/i});
    const sharedBtn = screen.getByRole('button', {name: /Shared with Me/i});
    const allBtn = screen.getByRole('button', {name: /All Libraries/i});

    expect(ownedBtn).toBeInTheDocument();
    expect(sharedBtn).toBeInTheDocument();
    expect(allBtn).toBeInTheDocument();

    // Verify concise labels exist for mobile viewports
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.getByText('All (Admin)')).toBeInTheDocument();
  });

  it('hides the admin chip when isAdmin is false', () => {
    const onToggleScope = vi.fn();
    render(
      <LibraryFilterControls
        scopes={['owned']}
        onToggleScope={onToggleScope}
        isAdmin={false}
      />
    );

    expect(screen.getByRole('button', {name: /My Libraries/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Shared with Me/i})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /All Libraries/i})).not.toBeInTheDocument();
  });

  it('calls onToggleScope when clicking a chip', () => {
    const onToggleScope = vi.fn();
    render(
      <LibraryFilterControls
        scopes={['owned']}
        onToggleScope={onToggleScope}
        isAdmin={true}
      />
    );

    const sharedBtn = screen.getByRole('button', {name: /Shared with Me/i});
    fireEvent.click(sharedBtn);
    expect(onToggleScope).toHaveBeenCalledWith('shared');
  });
});

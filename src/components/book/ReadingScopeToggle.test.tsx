import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {ReadingScopeToggle} from './ReadingScopeToggle';

describe('ReadingScopeToggle', () => {
  it('displays Read & Reading count and toggles Include Want to Read', () => {
    const onToggle = vi.fn();
    render(
      <ReadingScopeToggle
        readAndReadingCount={14}
        wantToReadCount={6}
        includeWantToRead={false}
        onToggleWantToRead={onToggle}
      />,
    );

    expect(screen.getByText('Read & Reading')).toBeInTheDocument();
    expect(screen.getByText('(14)')).toBeInTheDocument();
    expect(screen.getByText('(+6)')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {name: /Include Want to Read/i}),
    );
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

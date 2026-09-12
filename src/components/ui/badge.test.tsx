import React from 'react';
import {render, screen} from '@testing-library/react';
import {describe, it, expect} from 'vitest';
import {Badge} from './badge';

describe('Badge UI component', () => {
  it('renders default badge with children', () => {
    render(<Badge>Default Badge</Badge>);
    expect(screen.getByText('Default Badge')).toBeInTheDocument();
  });

  it('renders semantic status badges correctly', () => {
    const {container: c1} = render(
      <Badge variant="status-read">Finished</Badge>,
    );
    expect(c1.firstChild).toHaveClass('text-emerald-800');

    const {container: c2} = render(
      <Badge variant="status-reading">Reading</Badge>,
    );
    expect(c2.firstChild).toHaveClass('text-amber-800');

    const {container: c3} = render(
      <Badge variant="status-abandoned">Abandoned</Badge>,
    );
    expect(c3.firstChild).toHaveClass('text-rose-800');
  });

  it('renders genre and subgenre variants', () => {
    const {container: c1} = render(
      <Badge variant="genre">Science Fiction</Badge>,
    );
    expect(c1.firstChild).toHaveClass('text-primary');

    const {container: c2} = render(<Badge variant="subgenre">Cyberpunk</Badge>);
    expect(c2.firstChild).toHaveClass('text-on-surface-variant');
  });

  it('renders temporal variant with font-mono', () => {
    const {container} = render(<Badge variant="temporal">1850 – 1900</Badge>);
    expect(container.firstChild).toHaveClass('font-mono');
  });
});

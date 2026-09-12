import React from 'react';
import {render} from '@testing-library/react';
import {describe, it, expect} from 'vitest';
import {Loader, BookLoader} from './loader';

describe('Loader UI component', () => {
  it('renders default Loader with animated elements', () => {
    const {container} = render(<Loader size="md" />);
    expect(container.querySelector('.w-12')).toBeInTheDocument();
  });

  it('renders small and large size variants', () => {
    const {container: smContainer} = render(<Loader size="sm" />);
    expect(smContainer.querySelector('.w-8')).toBeInTheDocument();

    const {container: lgContainer} = render(<Loader size="lg" />);
    expect(lgContainer.querySelector('.w-16')).toBeInTheDocument();
  });

  it('renders BookLoader alias identical to Loader', () => {
    const {container} = render(
      <BookLoader size="sm" className="test-custom-class" />,
    );
    expect(container.querySelector('.test-custom-class')).toBeInTheDocument();
  });
});

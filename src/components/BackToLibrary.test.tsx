import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {BackToLibrary} from './BackToLibrary';

describe('BackToLibrary component', () => {
  it('renders default link targeting /library/:libraryId with default label', () => {
    render(
      <MemoryRouter>
        <BackToLibrary libraryId="lib-123" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', {name: /back to library/i});
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/library/lib-123');
  });

  it('respects customTo for location.state?.from routing', () => {
    render(
      <MemoryRouter>
        <BackToLibrary
          libraryId="lib-123"
          customTo="/library/lib-123/collection?genre=Fiction"
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', {name: /back to library/i});
    expect(link).toHaveAttribute(
      'href',
      '/library/lib-123/collection?genre=Fiction',
    );
  });

  it('renders custom label when provided', () => {
    render(
      <MemoryRouter>
        <BackToLibrary customTo="/" label="Back to Libraries" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', {name: /back to libraries/i});
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('renders button and executes onClick when no URL is provided', () => {
    const handleClick = vi.fn();
    render(<BackToLibrary onClick={handleClick} />);

    const button = screen.getByRole('button', {name: /back to library/i});
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('enforces min-height of 44px for touch accessibility on mobile', () => {
    render(
      <MemoryRouter>
        <BackToLibrary libraryId="lib-456" />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link');
    expect(link.className).toContain('min-h-[44px]');
  });
});

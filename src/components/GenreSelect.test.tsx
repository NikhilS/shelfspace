import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {GenreSelect} from './GenreSelect';

describe('GenreSelect component', () => {
  it('renders primary genre dropdown with canonical genres', () => {
    const onChange = vi.fn();
    render(<GenreSelect onChange={onChange} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Select Primary Genre...')).toBeInTheDocument();
    expect(screen.getByText('Science Fiction')).toBeInTheDocument();
    expect(screen.getByText('Fantasy')).toBeInTheDocument();
    expect(screen.getByText('Other (Custom Genre)')).toBeInTheDocument();
  });

  it('calls onChange with sanitized payload when primary genre is selected', () => {
    const onChange = vi.fn();
    render(<GenreSelect onChange={onChange} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, {target: {value: 'Science Fiction'}});

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryGenre: 'Science Fiction',
        subgenres: [],
        isCustomPrimary: false,
      }),
    );
  });

  it('displays subgenre buttons for canonical primary genre', () => {
    const onChange = vi.fn();
    render(
      <GenreSelect
        primaryGenre="Science Fiction"
        subgenres={['Hard Sci-Fi']}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Hard Sci-Fi')).toBeInTheDocument();
    expect(screen.getByText('Space Opera')).toBeInTheDocument();
    expect(screen.getByText('Cyberpunk')).toBeInTheDocument();
  });

  it('toggles a subgenre on click', () => {
    const onChange = vi.fn();
    render(
      <GenreSelect
        primaryGenre="Science Fiction"
        subgenres={['Hard Sci-Fi']}
        onChange={onChange}
      />,
    );

    const spaceOperaBtn = screen.getByText('Space Opera');
    fireEvent.click(spaceOperaBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryGenre: 'Science Fiction',
        subgenres: ['Hard Sci-Fi', 'Space Opera'],
        isCustomPrimary: false,
      }),
    );
  });

  it('displays custom text input when Other is selected', () => {
    const onChange = vi.fn();
    render(
      <GenreSelect
        primaryGenre="Other"
        isCustomPrimary={true}
        onChange={onChange}
      />,
    );

    const customInput = screen.getByPlaceholderText(/e\.g\., Paleontology/i);
    expect(customInput).toBeInTheDocument();

    fireEvent.change(customInput, {target: {value: 'Nordic Noir'}});
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryGenre: 'Nordic Noir',
        isCustomPrimary: true,
      }),
    );
  });
});

import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {Input} from './input';
import {Checkbox} from './checkbox';
import {Textarea} from './textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './select';

describe('Form Controls & Input Primitives (Phase 2b)', () => {
  it('renders Input with proper attributes and handles change', () => {
    const handleChange = vi.fn();
    render(
      <Input
        placeholder="Enter book title"
        onChange={handleChange}
        value="Dune"
      />,
    );
    const input = screen.getByPlaceholderText('Enter book title');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Dune');

    fireEvent.change(input, {target: {value: 'Neuromancer'}});
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders Checkbox and toggles state', () => {
    const handleCheckedChange = vi.fn();
    render(
      <Checkbox
        aria-label="Select book"
        checked={false}
        onCheckedChange={handleCheckedChange}
      />,
    );
    const checkbox = screen.getByLabelText('Select book');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');

    fireEvent.click(checkbox);
    expect(handleCheckedChange).toHaveBeenCalledWith(true);
  });

  it('renders Checkbox in indeterminate state with minus icon', () => {
    render(
      <Checkbox
        aria-label="Select all"
        checked="indeterminate"
        onCheckedChange={() => {}}
      />,
    );
    const checkbox = screen.getByLabelText('Select all');
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate');
  });

  it('renders Textarea and updates value', () => {
    const handleChange = vi.fn();
    render(
      <Textarea
        placeholder="Write a review..."
        onChange={handleChange}
        rows={4}
      />,
    );
    const textarea = screen.getByPlaceholderText('Write a review...');
    expect(textarea).toBeInTheDocument();

    fireEvent.change(textarea, {target: {value: 'A masterpiece.'}});
    expect(handleChange).toHaveBeenCalled();
  });

  it('renders Select with SelectTrigger and SelectValue', () => {
    render(
      <Select defaultValue="physical">
        <SelectTrigger aria-label="Format">
          <SelectValue placeholder="Select format" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="physical">Physical Book</SelectItem>
          <SelectItem value="digital">E-Book</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByLabelText('Format');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Physical Book');
  });
});

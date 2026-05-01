import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import BulkImport from './BulkImport';

describe('BulkImport', () => {
  const mockOnBooksExtracted = vi.fn();
  const mockSetIsExtracting = vi.fn();
  const mockSetCsvFormat = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders BulkImport component with GoodReads default format', () => {
    render(
      <BulkImport
        onBooksExtracted={mockOnBooksExtracted}
        isExtracting={false}
        setIsExtracting={mockSetIsExtracting}
        csvFormat="physical"
        setCsvFormat={mockSetCsvFormat}
      />,
    );

    expect(screen.getByText('Upload Library CSV')).toBeInTheDocument();
    expect(screen.getByText('Default Format')).toBeInTheDocument();
  });

  it('handles format change', () => {
    render(
      <BulkImport
        onBooksExtracted={mockOnBooksExtracted}
        isExtracting={false}
        setIsExtracting={mockSetIsExtracting}
        csvFormat="physical"
        setCsvFormat={mockSetCsvFormat}
      />,
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, {target: {value: 'digital'}});
    expect(mockSetCsvFormat).toHaveBeenCalledWith('digital');
  });

  it('displays extracting state', () => {
    render(
      <BulkImport
        onBooksExtracted={mockOnBooksExtracted}
        isExtracting={true}
        setIsExtracting={mockSetIsExtracting}
        csvFormat="physical"
        setCsvFormat={mockSetCsvFormat}
      />,
    );

    expect(screen.getByText(/Processing CSV.../i)).toBeInTheDocument();
  });
});

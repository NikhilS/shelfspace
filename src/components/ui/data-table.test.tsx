import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi} from 'vitest';
import {
  DataTable,
  DataTableColumn,
  DataTableCheckboxHeader,
  DataTableCheckboxCell,
  BookTitleCell,
  BookAuthorCell,
  BookDateCell,
  StatusDotCell,
} from './data-table';

interface TestItem {
  id: string;
  title: string;
  author: string;
}

describe('DataTable component', () => {
  const mockData: TestItem[] = [
    {id: '1', title: 'Dune', author: 'Frank Herbert'},
    {id: '2', title: 'Neuromancer', author: 'William Gibson'},
    {id: '3', title: 'Snow Crash', author: 'Neal Stephenson'},
  ];

  const columns: DataTableColumn<TestItem>[] = [
    {
      id: 'title',
      header: 'Title',
      sortable: true,
      cell: item => item.title,
    },
    {
      id: 'author',
      header: 'Author',
      cell: item => item.author,
    },
  ];

  it('renders standard semantic table when data count is <= 50', () => {
    render(
      <DataTable
        data={mockData}
        columns={columns}
        keyExtractor={item => item.id}
      />,
    );

    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Frank Herbert')).toBeInTheDocument();
    expect(screen.getByText('Neuromancer')).toBeInTheDocument();
    expect(screen.getByText('Snow Crash')).toBeInTheDocument();
  });

  it('renders empty placeholder when data is empty', () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        keyExtractor={item => item.id}
        emptyPlaceholder="No books found in shelf"
      />,
    );

    expect(screen.getByText('No books found in shelf')).toBeInTheDocument();
  });

  it('triggers onSort when sortable header is clicked', () => {
    const handleSort = vi.fn();
    render(
      <DataTable
        data={mockData}
        columns={columns}
        keyExtractor={item => item.id}
        sortColumn="title"
        sortDirection="asc"
        onSort={handleSort}
      />,
    );

    const titleHeader = screen.getByText('Title');
    fireEvent.click(titleHeader);

    expect(handleSort).toHaveBeenCalledWith('title');
  });

  it('triggers onRowClick when row is clicked', () => {
    const handleRowClick = vi.fn();
    render(
      <DataTable
        data={mockData}
        columns={columns}
        keyExtractor={item => item.id}
        onRowClick={handleRowClick}
      />,
    );

    fireEvent.click(screen.getByText('Dune'));
    expect(handleRowClick).toHaveBeenCalledWith(
      expect.objectContaining({id: '1', title: 'Dune'}),
      0,
      expect.anything(),
    );
  });
});

describe('Shared cell formatting components', () => {
  it('renders BookTitleCell with title and status badge', () => {
    render(
      <BookTitleCell
        title="hyperion"
        author="dan simmons"
        userStatus="reading"
      />,
    );

    expect(screen.getByText('Hyperion')).toBeInTheDocument();
    expect(screen.getByText('Dan Simmons')).toBeInTheDocument();
    expect(screen.getByText('READING')).toBeInTheDocument();
  });

  it('wraps and truncates long book titles with line-clamp and tooltip', () => {
    const longTitle =
      'The Lord of the Rings: 50th Anniversary One-Volume Edition with The Fellowship of the Ring and The Two Towers';
    render(
      <BookTitleCell
        title={longTitle}
        author="j.r.r. tolkien"
        maxWidth={320}
      />,
    );

    const titleElement = screen.getByText(/The Lord of the Rings/i);
    expect(titleElement).toBeInTheDocument();
    expect(titleElement.className).toContain('line-clamp-2');
    expect(titleElement.className).toContain('break-words');
    expect(titleElement.className).toContain('whitespace-normal');
    expect(titleElement).toHaveAttribute('title', longTitle);
  });

  it('supports single-line truncation when truncateSingleLine or maxLines=1 is specified', () => {
    render(
      <BookTitleCell
        title="Super Long Title That Should Be On A Single Truncated Line"
        truncateSingleLine
      />,
    );

    const titleEl = screen.getByText(/Super Long Title/);
    expect(titleEl.className).toContain('truncate');
    expect(titleEl.className).toContain('whitespace-nowrap');
  });

  it('supports compact size="sm" and showCover=false', () => {
    const {container} = render(
      <BookTitleCell
        title="Dune"
        author="frank herbert"
        size="sm"
        showCover={false}
      />,
    );

    const titleEl = screen.getByText('Dune');
    expect(titleEl.className).toContain('text-sm');
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('.h-9')).not.toBeInTheDocument();
  });

  it('renders BookAuthorCell in TitleCase', () => {
    render(<BookAuthorCell author="ursula k. le guin" />);
    expect(screen.getByText('Ursula K. Le Guin')).toBeInTheDocument();
  });

  it('renders BookDateCell', () => {
    render(<BookDateCell date="2026-05-15T12:00:00Z" />);
    expect(screen.getByText(/May \d+, 2026/)).toBeInTheDocument();
  });

  it('renders StatusDotCell correctly', () => {
    const {container: c1} = render(
      <StatusDotCell present={true} title="Present" />,
    );
    expect(c1.querySelector('.bg-emerald-500\\/80')).toBeInTheDocument();

    const {container: c2} = render(
      <StatusDotCell present={false} title="Missing" />,
    );
    expect(c2.querySelector('.bg-error\\/40')).toBeInTheDocument();
  });

  it('renders DataTableCheckboxHeader and DataTableCheckboxCell', () => {
    const onHeaderChange = vi.fn();
    const onCellChange = vi.fn();

    render(
      <div>
        <DataTableCheckboxHeader
          checked={false}
          onCheckedChange={onHeaderChange}
          ariaLabel="Select All"
        />
        <DataTableCheckboxCell
          checked={true}
          onCheckedChange={onCellChange}
          ariaLabel="Select Item"
        />
      </div>,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[1]).toBeChecked();
  });
});

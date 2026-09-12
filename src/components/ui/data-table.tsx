import React, {forwardRef} from 'react';
import {TableVirtuoso} from 'react-virtuoso';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './table';
import {Checkbox} from './checkbox';
import {Badge} from './badge';
import {ArrowUp, ArrowDown, ArrowUpDown} from 'lucide-react';
import {cn, toTitleCase, getFirestoreTime} from '../../lib/utils';
import {FirestoreDate} from '../../types';

export interface DataTableColumn<T> {
  id: string;
  header:
    | React.ReactNode
    | ((props: {
        column: DataTableColumn<T>;
        sortColumn?: string | null;
        sortDirection?: 'asc' | 'desc' | null;
        onSort?: (columnId: string) => void;
      }) => React.ReactNode);
  cell: (item: T, index: number) => React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  truncate?: boolean;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  keyExtractor: (item: T, index: number) => string;
  // Sorting
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: (columnId: string) => void;
  // Row selection / clicking
  onRowClick?: (
    item: T,
    index: number,
    event: React.MouseEvent<HTMLTableRowElement>,
  ) => void;
  rowClassName?: (item: T, index: number) => string;
  // Empty state
  emptyPlaceholder?: React.ReactNode;
  // Dual-mode pipeline configuration: default threshold is 50
  virtualizationThreshold?: number;
  mode?: 'auto' | 'static' | 'virtualized';
  // Styling
  className?: string;
  tableClassName?: string;
  headerClassName?: string;
  headerRowClassName?: string;
  bodyClassName?: string;
  style?: React.CSSProperties;
  useWindowScroll?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  rowClassName,
  emptyPlaceholder,
  virtualizationThreshold = 50,
  mode = 'auto',
  className,
  tableClassName,
  headerClassName,
  headerRowClassName,
  bodyClassName,
  style,
  useWindowScroll = true,
}: DataTableProps<T>) {
  const threshold = virtualizationThreshold ?? 50;
  const isVirtualized =
    mode === 'virtualized' || (mode !== 'static' && data.length > threshold);

  const renderHeaderCell = (col: DataTableColumn<T>) => {
    const isSorted = sortColumn === col.id;
    return (
      <TableHead
        key={col.id}
        style={{
          ...(col.width !== undefined ? {width: col.width} : {}),
          ...(col.minWidth !== undefined ? {minWidth: col.minWidth} : {}),
          ...(col.maxWidth !== undefined ? {maxWidth: col.maxWidth} : {}),
        }}
        className={cn(
          col.sortable &&
            'cursor-pointer hover:bg-surface-variant/30 transition-colors select-none',
          col.align === 'center'
            ? 'text-center'
            : col.align === 'right'
              ? 'text-right'
              : 'text-left',
          col.headerClassName,
        )}
        onClick={e => {
          if (col.sortable && onSort) {
            e.stopPropagation();
            onSort(col.id);
          }
        }}
      >
        <div
          className={cn(
            'flex items-center gap-1.5',
            col.align === 'center'
              ? 'justify-center'
              : col.align === 'right'
                ? 'justify-end'
                : 'justify-start',
          )}
        >
          {typeof col.header === 'function'
            ? col.header({column: col, sortColumn, sortDirection, onSort})
            : col.header}
          {col.sortable && (
            <span className="inline-flex text-on-surface-variant">
              {isSorted ? (
                sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 text-primary" />
                )
              ) : (
                <ArrowUpDown className="w-3.5 h-3.5 opacity-30 hover:opacity-70" />
              )}
            </span>
          )}
        </div>
      </TableHead>
    );
  };

  const renderCell = (col: DataTableColumn<T>, item: T, index: number) => {
    return (
      <TableCell
        key={col.id}
        style={{
          ...(col.width !== undefined ? {width: col.width} : {}),
          ...(col.minWidth !== undefined ? {minWidth: col.minWidth} : {}),
          ...(col.maxWidth !== undefined ? {maxWidth: col.maxWidth} : {}),
        }}
        className={cn(
          col.align === 'center'
            ? 'text-center'
            : col.align === 'right'
              ? 'text-right'
              : 'text-left',
          col.wrap && 'whitespace-normal break-words',
          col.truncate && 'truncate overflow-hidden max-w-[260px]',
          col.maxWidth !== undefined && 'overflow-hidden',
          col.cellClassName,
        )}
      >
        {col.cell(item, index)}
      </TableCell>
    );
  };

  // Empty state handling
  if (data.length === 0) {
    return (
      <Table className={tableClassName}>
        <TableHeader className={headerClassName}>
          <TableRow className={headerRowClassName}>
            {columns.map(col => renderHeaderCell(col))}
          </TableRow>
        </TableHeader>
        <TableBody className={bodyClassName}>
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="text-center py-12 text-on-surface-variant font-sans"
            >
              {emptyPlaceholder ?? 'No items to display.'}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  // Virtualized Mode (> 50 rows by default)
  if (isVirtualized) {
    return (
      <TableVirtuoso
        data={data}
        useWindowScroll={useWindowScroll}
        style={style}
        className={cn('w-full text-left border-collapse', className)}
        components={{
          Table: ({style, ...props}) => (
            <table
              data-slot="table"
              {...props}
              style={style}
              className={cn('w-full caption-bottom text-sm', tableClassName)}
            />
          ),
          TableHead: forwardRef<
            HTMLTableSectionElement,
            React.HTMLAttributes<HTMLTableSectionElement>
          >((props, ref) => (
            <thead
              data-slot="table-header"
              {...props}
              ref={ref}
              className={cn('[&_tr]:border-b', headerClassName)}
            />
          )),
          TableRow: ({item, ...props}) => {
            const index = (props as Record<string, unknown>)[
              'data-item-index'
            ] as number;
            const customClass =
              rowClassName && item ? rowClassName(item, index) : '';
            return (
              <tr
                data-slot="table-row"
                {...props}
                onClick={e => {
                  (
                    props as React.HTMLAttributes<HTMLTableRowElement>
                  ).onClick?.(e);
                  if (item && onRowClick) onRowClick(item, index, e);
                }}
                className={cn(
                  'border-b border-outline-variant/30 transition-colors hover:bg-surface-container-low/50 cursor-pointer',
                  customClass,
                )}
              />
            );
          },
          TableBody: forwardRef<
            HTMLTableSectionElement,
            React.HTMLAttributes<HTMLTableSectionElement>
          >((props, ref) => (
            <tbody
              data-slot="table-body"
              {...props}
              ref={ref}
              className={cn(
                '[&_tr:last-child]:border-0 divide-y divide-outline-variant/20',
                bodyClassName,
              )}
            />
          )),
        }}
        fixedHeaderContent={() => (
          <TableRow
            className={cn(
              'border-b border-outline-variant/40 shadow-sm bg-surface-container-low',
              headerRowClassName,
            )}
          >
            {columns.map(col => renderHeaderCell(col))}
          </TableRow>
        )}
        itemContent={(index, item) => (
          <>{columns.map(col => renderCell(col, item, index))}</>
        )}
      />
    );
  }

  // Standard Semantic Mode (<= 50 rows)
  return (
    <Table className={tableClassName}>
      <TableHeader className={headerClassName}>
        <TableRow className={headerRowClassName}>
          {columns.map(col => renderHeaderCell(col))}
        </TableRow>
      </TableHeader>
      <TableBody
        className={cn('divide-y divide-outline-variant/20', bodyClassName)}
      >
        {data.map((item, index) => {
          const key = keyExtractor(item, index);
          const customClass = rowClassName ? rowClassName(item, index) : '';
          return (
            <TableRow
              key={key}
              onClick={e => onRowClick?.(item, index, e)}
              className={cn(
                'border-b border-outline-variant/30 transition-colors hover:bg-surface-container-low/50 cursor-pointer',
                customClass,
              )}
            >
              {columns.map(col => renderCell(col, item, index))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------
// Shared Cell Formatting & Header Components
// ---------------------------------------------------------

export function DataTableCheckboxHeader({
  checked,
  onCheckedChange,
  ariaLabel = 'Select all',
  className,
}: {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      onClick={e => e.stopPropagation()}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={val => onCheckedChange(Boolean(val))}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export function DataTableCheckboxCell({
  checked,
  onCheckedChange,
  ariaLabel = 'Select row',
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center justify-center', className)}
      onClick={e => e.stopPropagation()}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={val => onCheckedChange(Boolean(val))}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export interface BookTitleCellProps {
  title: string;
  author?: string;
  coverUrl?: string | null;
  userStatus?: 'reading' | 'finished' | 'abandoned' | string | null;
  isSelected?: boolean;
  showCheckbox?: boolean;
  showCover?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  className?: string;
  titleClassName?: string;
  authorClassName?: string;
  maxLines?: number;
  maxWidth?: string | number;
  truncateSingleLine?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function BookTitleCell({
  title,
  author,
  coverUrl,
  userStatus,
  isSelected = false,
  showCheckbox = false,
  showCover = true,
  onToggleSelect,
  className,
  titleClassName,
  authorClassName,
  maxLines = 2,
  maxWidth,
  truncateSingleLine = false,
  size = 'md',
}: BookTitleCellProps) {
  const hash = (title || '')
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradients = [
    'from-on-tertiary-fixed-variant to-tertiary-container',
    'from-secondary to-on-secondary-fixed',
    'from-primary to-on-primary-fixed',
    'from-on-primary-container to-surface-tint',
    'from-surface-container-highest to-surface-dim',
  ];
  const gradientClass = gradients[hash % gradients.length];

  const coverSizes = {
    sm: 'h-9 w-6 rounded-xs',
    md: 'h-12 w-8 rounded-sm',
    lg: 'h-14 w-9 rounded-sm',
  };

  const titleSizes = {
    sm: 'text-sm font-medium text-on-surface leading-tight',
    md: 'font-serif text-base sm:text-lg font-medium text-on-surface leading-snug',
    lg: 'font-serif text-lg sm:text-xl font-medium text-on-surface leading-snug',
  };

  const defaultMaxWidths = {
    sm: 'max-w-[200px] sm:max-w-[260px] md:max-w-[320px]',
    md: 'max-w-[240px] sm:max-w-[320px] md:max-w-[400px]',
    lg: 'max-w-[280px] sm:max-w-[380px] md:max-w-[460px]',
  };

  const formattedTitle = toTitleCase(title || 'Untitled');
  const formattedAuthor = author ? toTitleCase(author) : undefined;

  const clampClass =
    truncateSingleLine || maxLines === 1
      ? 'truncate whitespace-nowrap overflow-hidden block'
      : maxLines === 3
        ? 'line-clamp-3 whitespace-normal break-words overflow-hidden'
        : 'line-clamp-2 whitespace-normal break-words overflow-hidden';

  const containerStyle: React.CSSProperties = {
    ...(maxWidth !== undefined
      ? {
          maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
        }
      : {}),
  };

  return (
    <div
      className={cn(
        'flex items-center group/cover min-w-0',
        size === 'sm' ? 'gap-2.5 sm:gap-3' : 'gap-3 sm:gap-4',
        maxWidth === undefined && defaultMaxWidths[size],
        className,
      )}
      style={containerStyle}
      title={title}
    >
      {showCover && (
        <div
          className={cn(
            coverSizes[size],
            'flex-shrink-0 relative overflow-hidden cursor-pointer shadow-xs border border-outline-variant/30',
          )}
          onClick={e => {
            if (onToggleSelect) {
              e.stopPropagation();
              onToggleSelect(e);
            }
          }}
        >
          {showCheckbox && (
            <div
              className={cn(
                'absolute inset-0 z-20 flex items-center justify-center transition-all',
                isSelected
                  ? 'opacity-100 bg-transparent'
                  : 'opacity-0 group-hover/cover:opacity-100 hover:bg-surface-variant/30',
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {}}
                className="pointer-events-none w-4 h-4 bg-surface"
                aria-label={`Select ${title}`}
              />
            </div>
          )}
          <div
            className={cn(
              'absolute inset-0 bg-surface-variant transition-opacity',
              showCheckbox && isSelected
                ? 'opacity-0'
                : 'opacity-100 group-hover/cover:opacity-0',
            )}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <div
                className={`absolute inset-0 bg-gradient-to-br ${gradientClass} opacity-80`}
              />
            )}
          </div>
        </div>
      )}
      <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            className={cn(
              titleSizes[size],
              clampClass,
              'min-w-0 flex-1',
              titleClassName,
            )}
            title={title}
          >
            {formattedTitle}
          </span>
          {userStatus && userStatus !== 'unset' && (
            <Badge
              size="sm"
              variant={
                userStatus === 'reading'
                  ? 'status-reading'
                  : userStatus === 'finished'
                    ? 'status-read'
                    : 'status-abandoned'
              }
              className="shrink-0"
            >
              {userStatus === 'reading'
                ? 'READING'
                : userStatus === 'finished'
                  ? 'FINISHED'
                  : 'ABANDONED'}
            </Badge>
          )}
        </div>
        {formattedAuthor && (
          <span
            className={cn(
              'text-xs text-on-surface-variant font-sans truncate block max-w-full overflow-hidden mt-0.5',
              authorClassName,
            )}
            title={author}
          >
            {formattedAuthor}
          </span>
        )}
      </div>
    </div>
  );
}

export function BookAuthorCell({
  author,
  className,
}: {
  author: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-body-md text-body-md text-on-surface-variant',
        className,
      )}
    >
      {toTitleCase(author)}
    </span>
  );
}

export function BookDateCell({
  date,
  className,
}: {
  date: string | number | Date | FirestoreDate | null | undefined;
  className?: string;
}) {
  if (!date) {
    return <span className={cn('text-outline text-xs', className)}>—</span>;
  }
  const time = getFirestoreTime(date);
  const formatted = time
    ? new Date(time).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Unknown';
  return (
    <span
      className={cn(
        'font-body-md text-outline whitespace-nowrap text-sm',
        className,
      )}
    >
      {formatted}
    </span>
  );
}

export function StatusDotCell({
  present,
  title,
  className,
}: {
  present: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      {present ? (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500/80"
          title={title ?? 'Present'}
        />
      ) : (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full bg-error/40"
          title={title ?? 'Missing'}
        />
      )}
    </div>
  );
}

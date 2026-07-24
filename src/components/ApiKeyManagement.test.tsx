import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {ApiKeyManagement} from './ApiKeyManagement';

const mockMutateCreate = vi.fn();
const mockMutateRevoke = vi.fn();
const mockRefetch = vi.fn();
const mockInvalidate = vi.fn();

let mockListQueryData: unknown[] | null = [
  {
    id: 'key1',
    name: 'CLI Tool',
    keyPrefix: 'lib_live_12345678',
    keySuffix: '90ab',
    createdAt: '2026-06-01T12:00:00.000Z',
    lastUsedAt: null,
    revoked: false,
  },
  {
    id: 'key2',
    name: 'Old Script',
    keyPrefix: 'lib_live_87654321',
    keySuffix: 'cdef',
    createdAt: '2026-01-01T12:00:00.000Z',
    lastUsedAt: '2026-02-01T12:00:00.000Z',
    revoked: true,
  },
];

let mockIsLoading = false;

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      apiKey: {
        list: {
          invalidate: mockInvalidate,
        },
      },
    }),
    apiKey: {
      list: {
        useQuery: () => ({
          data: mockListQueryData,
          isLoading: mockIsLoading,
          refetch: mockRefetch,
        }),
      },
      create: {
        useMutation: (opts: {onSuccess?: (data: {key: string; name: string}) => void}) => ({
          mutate: (input: {name: string}) => {
            mockMutateCreate(input);
            opts?.onSuccess?.({key: 'lib_live_secret1234567890abcdef', name: input.name});
          },
          isPending: false,
        }),
      },
      revoke: {
        useMutation: (opts: {onSuccess?: () => void}) => ({
          mutate: (input: {keyId: string}) => {
            mockMutateRevoke(input);
            opts?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

describe('ApiKeyManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListQueryData = [
      {
        id: 'key1',
        name: 'CLI Tool',
        keyPrefix: 'lib_live_12345678',
        keySuffix: '90ab',
        createdAt: '2026-06-01T12:00:00.000Z',
        lastUsedAt: null,
        revoked: false,
      },
    ];
    mockIsLoading = false;
  });

  it('renders API Key management title and description', () => {
    render(<ApiKeyManagement />);

    expect(screen.getByText('API Keys & External Access')).toBeInTheDocument();
    expect(
      screen.getByText(/Generate secret keys for programmatic REST \/ tRPC access/i),
    ).toBeInTheDocument();
  });

  it('renders active key list with prefix, suffix, and last used status', () => {
    render(<ApiKeyManagement />);

    expect(screen.getByText('CLI Tool')).toBeInTheDocument();
    expect(screen.getByText(/lib_live_12345678...90ab/)).toBeInTheDocument();
    expect(screen.getByText(/Active/i)).toBeInTheDocument();
  });

  it('submits new key form and opens modal displaying raw secret key once', async () => {
    render(<ApiKeyManagement />);

    const input = screen.getByPlaceholderText(/Key description/i);
    const createBtn = screen.getByText('Create Secret Key');

    fireEvent.change(input, {target: {value: 'My New Backend Service'}});
    fireEvent.click(createBtn);

    expect(mockMutateCreate).toHaveBeenCalledWith({name: 'My New Backend Service'});

    // Secret Key Modal should appear
    expect(await screen.findByText('API Key Created Successfully')).toBeInTheDocument();
    expect(screen.getByText('lib_live_secret1234567890abcdef')).toBeInTheDocument();
  });

  it('allows user to revoke an existing key with confirmation dialog', async () => {
    render(<ApiKeyManagement />);

    const revokeBtn = screen.getByTitle('Revoke API key');
    fireEvent.click(revokeBtn);

    expect(screen.getByText('Revoke API Key?')).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', {name: 'Revoke Key'});

    fireEvent.click(confirmBtn);

    expect(mockMutateRevoke).toHaveBeenCalledWith({keyId: 'key1'});
    await waitFor(() => {
      expect(mockInvalidate).toHaveBeenCalled();
    });
  });
});

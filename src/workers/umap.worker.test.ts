import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {UmapWorkerRequest} from './umap.worker';

describe('umap.worker message protocol', () => {
  const postMessageMock = vi.fn();

  beforeEach(async () => {
    postMessageMock.mockReset();
    vi.stubGlobal('self', {
      postMessage: postMessageMock,
      onmessage: null,
    });
    vi.resetModules();
    await import('./umap.worker');
  });

  it('handles geometryOnly mode for empty and populated rawCoords', () => {
    const handler = (
      self as unknown as {
        onmessage: (e: MessageEvent<UmapWorkerRequest>) => void;
      }
    ).onmessage;

    handler({
      data: {mode: 'geometryOnly', rawCoords: []},
    } as MessageEvent<UmapWorkerRequest>);
    expect(postMessageMock).toHaveBeenLastCalledWith({
      relaxedCoords: [],
      neighborIndexLists: [],
      softMemberships: [],
    });

    handler({
      data: {
        mode: 'geometryOnly',
        rawCoords: [
          {x: -10, y: -10},
          {x: 10, y: 10},
          {x: 20, y: -15},
        ],
        clusterIds: [0, 0, 1],
      },
    } as MessageEvent<UmapWorkerRequest>);

    const result = postMessageMock.mock.calls[1][0];
    expect(result.relaxedCoords).toHaveLength(3);
    expect(result.neighborIndexLists).toHaveLength(3);
    expect(result.softMemberships).toHaveLength(3);
  });

  it('returns an error when fewer than 2 valid embeddings are provided in full mode', () => {
    const handler = (
      self as unknown as {
        onmessage: (e: MessageEvent<UmapWorkerRequest>) => void;
      }
    ).onmessage;

    handler({
      data: {mode: 'full', embeddings: [[0.1, 0.2, 0.3], undefined]},
    } as MessageEvent<UmapWorkerRequest>);

    expect(postMessageMock).toHaveBeenCalledWith({
      error: 'Not enough data points for UMAP',
    });
  });

  it('executes full UMAP projection, optimal K-Means clustering, and force relaxation', () => {
    const handler = (
      self as unknown as {
        onmessage: (e: MessageEvent<UmapWorkerRequest>) => void;
      }
    ).onmessage;

    const embeddings = [
      [1, 0, 0, 0],
      [0.95, 0.05, 0, 0],
      [0.9, 0.1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0.95, 0.05],
      [0, 0, 0.9, 0.1],
    ];

    handler({
      data: {
        mode: 'full',
        embeddings,
        nNeighbors: 3,
        seed: 42,
      },
    } as MessageEvent<UmapWorkerRequest>);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const payload = postMessageMock.mock.calls[0][0];
    expect(payload.error).toBeUndefined();
    expect(payload.reduced).toHaveLength(6);
    expect(payload.labels).toHaveLength(6);
    expect(payload.relaxedCoords).toHaveLength(6);
    expect(payload.neighborIndexLists).toHaveLength(6);
    expect(payload.softMemberships).toHaveLength(6);
  });
});

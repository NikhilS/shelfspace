export interface Point2D {
  x: number;
  y: number;
}

export interface SoftClusterMembership {
  primaryClusterId: number;
  secondaryClusterId: number;
  secondaryWeight: number;
}

export interface SemanticWebEdge {
  u: number;
  v: number;
  sourceClusterId: number;
  targetClusterId: number;
  isCrossCluster: boolean;
  similarity: number;
}

export interface SemanticNeighborIndex {
  index: number;
  similarity: number;
}

export interface CrossClusterBridge {
  sourceIndex: number;
  targetIndex: number;
  sourceClusterId: number;
  targetClusterId: number;
  similarity: number;
}

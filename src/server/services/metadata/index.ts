export {
  type FastTierOnCreateResult,
  mergeOnCreateUpdateMaps,
  MetadataRegistry,
  metadataRegistry,
  type OnCreateEnrichmentOptions,
} from './registry';
export {
  applyNonDestructiveBonusCatalogPatch,
  extractBonusCatalogFields,
  hydrateCatalogForResidualBooks,
  mergeBonusCatalogFields,
} from './bonusCatalogPatcher';
export {
  executePluginStagesHorizontally,
  runPluginStagesToRecord,
} from './stageRunner';
export {resolveBookSynopses} from './utils';
export {GeoMetadataProvider} from './providers/GeoMetadataProvider';
export {TemporalMetadataProvider} from './providers/TemporalMetadataProvider';
export {GenreMetadataProvider} from './providers/GenreMetadataProvider';
export {SynopsisMetadataProvider} from './providers/SynopsisMetadataProvider';
export {AuthorBioMetadataProvider} from './providers/AuthorBioMetadataProvider';
export {CoverImageMetadataProvider} from './providers/CoverImageMetadataProvider';
export {EmbeddingMetadataProvider} from './providers/EmbeddingMetadataProvider';
export {SeriesMetadataProvider} from './providers/SeriesMetadataProvider';

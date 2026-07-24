import {MetadataRegistry} from './registry';
import {SynopsisMetadataProvider} from './providers/SynopsisMetadataProvider';
import {AuthorBioMetadataProvider} from './providers/AuthorBioMetadataProvider';
import {GeoMetadataProvider} from './providers/GeoMetadataProvider';
import {TemporalMetadataProvider} from './providers/TemporalMetadataProvider';
import {GenreMetadataProvider} from './providers/GenreMetadataProvider';
import {EmbeddingMetadataProvider} from './providers/EmbeddingMetadataProvider';
import {CoverImageMetadataProvider} from './providers/CoverImageMetadataProvider';

// Initialize the registry
export const registry = MetadataRegistry.getInstance();

registry.register(new SynopsisMetadataProvider());
registry.register(new AuthorBioMetadataProvider());
registry.register(new GeoMetadataProvider());
registry.register(new TemporalMetadataProvider());
registry.register(new GenreMetadataProvider());
registry.register(new EmbeddingMetadataProvider());
registry.register(new CoverImageMetadataProvider());

export {MetadataRegistry} from './registry';
export * from '../../../types/metadata';

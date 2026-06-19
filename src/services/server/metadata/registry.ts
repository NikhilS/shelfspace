import {IMetadataProvider, MetadataKey} from '../../../types/metadata';

export class MetadataRegistry {
  private static instance: MetadataRegistry;
  private providers: Map<MetadataKey, IMetadataProvider> = new Map();

  static getInstance(): MetadataRegistry {
    if (!this.instance) this.instance = new MetadataRegistry();
    return this.instance;
  }

  register(provider: IMetadataProvider) {
    this.providers.set(provider.getKey(), provider);
  }

  getProvider(type: MetadataKey): IMetadataProvider | undefined {
    return this.providers.get(type);
  }

  getAllProviders(): IMetadataProvider[] {
    return Array.from(this.providers.values());
  }
}

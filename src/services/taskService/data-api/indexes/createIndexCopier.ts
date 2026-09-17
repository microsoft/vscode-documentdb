import { type CollectionIndexCopier } from './CollectionIndexCopier';
import {
    DocumentDbCollectionIndexCopier,
    type DocumentDbCollectionEndpoint,
} from './DocumentDbCollectionIndexCopier';

export function createIndexCopier(
    source: DocumentDbCollectionEndpoint,
    target: DocumentDbCollectionEndpoint,
): CollectionIndexCopier {
    return new DocumentDbCollectionIndexCopier(source, target);
}
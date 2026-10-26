import {
  verifyLibraryAccess,
  getUserRole,
  upsertCollaborator,
  removeCollaborator,
  getCollaboratorStatuses,
} from './libraryShareService';
import {
  getUserLibraries,
  getLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  libraryDocConverter,
  LibraryApiRecord,
} from './libraryCrudService';
import {
  resetMetadata,
  auditPlaceholderCovers,
  listAllowedDuplicates,
  allowDuplicateGroup,
  allowedDuplicateConverter,
  uploadImage,
} from './librarySpruceService';

export type {LibraryApiRecord};

export class LibraryService {
  static verifyLibraryAccess = verifyLibraryAccess;
  static getUserLibraries = getUserLibraries;
  static resetMetadata = resetMetadata;
  static auditPlaceholderCovers = auditPlaceholderCovers;
  static getLibrary = getLibrary;
  static createLibrary = createLibrary;
  static updateLibrary = updateLibrary;
  static deleteLibrary = deleteLibrary;
  static getUserRole = getUserRole;
  static upsertCollaborator = upsertCollaborator;
  static removeCollaborator = removeCollaborator;
  static getCollaboratorStatuses = getCollaboratorStatuses;
  static listAllowedDuplicates = listAllowedDuplicates;
  static allowDuplicateGroup = allowDuplicateGroup;
  static uploadImage = uploadImage;
}

export {
  verifyLibraryAccess,
  getUserLibraries,
  resetMetadata,
  auditPlaceholderCovers,
  getLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  libraryDocConverter,
  getUserRole,
  upsertCollaborator,
  removeCollaborator,
  getCollaboratorStatuses,
  listAllowedDuplicates,
  allowDuplicateGroup,
  allowedDuplicateConverter,
  uploadImage,
};

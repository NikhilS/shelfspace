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
  LibraryApiRecord,
} from './libraryCrudService';
import {
  resetMetadata,
  listAllowedDuplicates,
  allowDuplicateGroup,
  uploadImage,
} from './librarySpruceService';

export type {LibraryApiRecord};

export class LibraryService {
  static verifyLibraryAccess = verifyLibraryAccess;
  static getUserLibraries = getUserLibraries;
  static resetMetadata = resetMetadata;
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
  getLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  getUserRole,
  upsertCollaborator,
  removeCollaborator,
  getCollaboratorStatuses,
  listAllowedDuplicates,
  allowDuplicateGroup,
  uploadImage,
};

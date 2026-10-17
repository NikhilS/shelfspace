import {verifyLibraryAccess, getUserRole} from './libraryShareService';
import {
  getUserLibraries,
  getFilteredBooks,
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
  static getFilteredBooks = getFilteredBooks;
  static resetMetadata = resetMetadata;
  static getLibrary = getLibrary;
  static createLibrary = createLibrary;
  static updateLibrary = updateLibrary;
  static deleteLibrary = deleteLibrary;
  static getUserRole = getUserRole;
  static listAllowedDuplicates = listAllowedDuplicates;
  static allowDuplicateGroup = allowDuplicateGroup;
  static uploadImage = uploadImage;
}

export {
  verifyLibraryAccess,
  getUserLibraries,
  getFilteredBooks,
  resetMetadata,
  getLibrary,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  getUserRole,
  listAllowedDuplicates,
  allowDuplicateGroup,
  uploadImage,
};

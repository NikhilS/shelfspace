import React from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {X, Share2, Settings, Download, Trash2} from 'lucide-react';
import {Library} from '../../types';
import {useDebugMode} from '../../hooks/useDebugMode';
import {Bug} from 'lucide-react';

interface LibrarySettingsModalsProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isAdvancedSettingsOpen: boolean;
  setIsAdvancedSettingsOpen: (open: boolean) => void;
  libraryToDelete: boolean;
  setLibraryToDelete: (toDelete: boolean) => void;
  library: Library;
  isOwner: boolean;
  canEdit: boolean;
  shareEmail: string;
  setShareEmail: (email: string) => void;
  handleShare: (e: React.FormEvent) => void;
  handleRemoveShare: (email: string) => void;
  handleExportToCSV: () => void;
  handleDeleteLibrary: () => void;
  confirmDeleteLibrary: () => void;
}

export const LibrarySettingsModals: React.FC<LibrarySettingsModalsProps> = ({
  isSettingsOpen,
  setIsSettingsOpen,
  isAdvancedSettingsOpen,
  setIsAdvancedSettingsOpen,
  libraryToDelete,
  setLibraryToDelete,
  library,
  isOwner,
  canEdit,
  shareEmail,
  setShareEmail,
  handleShare,
  handleRemoveShare,
  handleExportToCSV,
  handleDeleteLibrary,
  confirmDeleteLibrary,
}) => {
  const {isDebugMode, toggleDebugMode} = useDebugMode();

  return (
    <>
      <AnimatePresence>
        {isSettingsOpen && isOwner && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface">
                  <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                    <Share2 size={20} />
                  </div>
                  Share & Settings
                </h3>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mb-10">
                <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
                  Share Access
                </h4>
                <form onSubmit={handleShare} className="flex gap-3 mb-6">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={e => setShareEmail(e.target.value)}
                    placeholder="friend@email.com"
                    className="flex-1 bg-surface-container border border-outline-variant/50 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-primary text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-opacity-90 transition-all shadow-sm"
                  >
                    Share
                  </button>
                </form>
                <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {library.sharedWith.length === 0 ? (
                    <div className="bg-surface-container border border-outline-variant/50 rounded-xl p-4 text-center">
                      <p className="text-sm text-on-surface-variant">
                        Not shared with anyone yet.
                      </p>
                    </div>
                  ) : (
                    library.sharedWith.map(email => (
                      <div
                        key={email}
                        className="flex items-center justify-between bg-surface-container border border-outline-variant/50 px-4 py-3 rounded-xl text-sm group hover:border-outline-variant transition-colors"
                      >
                        <span className="truncate mr-3 font-medium text-on-surface">
                          {email}
                        </span>
                        <button
                          onClick={() => handleRemoveShare(email)}
                          className="text-on-surface-variant hover:text-error p-1.5 rounded-md hover:bg-error-container transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdvancedSettingsOpen && canEdit && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
            onClick={() => setIsAdvancedSettingsOpen(false)}
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface">
                  <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                    <Settings size={20} />
                  </div>
                  Advanced Settings
                </h3>
                <button
                  onClick={() => setIsAdvancedSettingsOpen(false)}
                  className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mb-10">
                <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
                  Export Data
                </h4>
                <button
                  onClick={handleExportToCSV}
                  className="w-full flex items-center justify-center gap-2 bg-surface-container text-on-surface border border-outline-variant/50 px-5 py-4 rounded-xl hover:bg-surface transition-colors text-sm font-medium shadow-sm"
                >
                  <Download size={18} /> Export to CSV (Google Sheets)
                </button>
                <p className="text-xs text-on-surface-variant mt-3 text-center">
                  Download your library as a CSV file to import into Google
                  Sheets or Excel.
                </p>
              </div>

              <div className="mb-10">
                <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
                  Developer Tools
                </h4>
                <button
                  onClick={toggleDebugMode}
                  className={`w-full flex items-center justify-center gap-2 border px-5 py-4 rounded-xl transition-colors text-sm font-medium ${isDebugMode ? 'bg-primary text-white border-primary shadow-sm' : 'bg-surface-container text-on-surface border-outline-variant/50 hover:bg-surface shadow-sm'}`}
                >
                  <Bug size={18} />{' '}
                  {isDebugMode ? 'Disable Debug Mode' : 'Enable Debug Mode'}
                </button>
              </div>

              {isOwner && (
                <div className="pt-8 border-t border-outline-variant/30">
                  <h4 className="text-sm font-medium text-error mb-4 uppercase tracking-wider">
                    Danger Zone
                  </h4>
                  <button
                    onClick={handleDeleteLibrary}
                    className="w-full flex items-center justify-center gap-2 bg-error-container/50 text-error border border-error-container px-5 py-4 rounded-xl hover:bg-error-container transition-colors text-sm font-medium"
                  >
                    <Trash2 size={18} /> Delete Library
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {libraryToDelete && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans"
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="bg-surface rounded-[32px] p-8 max-w-sm w-full shadow-xl border border-outline-variant/30"
            >
              <div className="w-12 h-12 bg-error-container rounded-full flex items-center justify-center text-on-error-container mb-5 border border-error-container">
                <Trash2 size={24} />
              </div>
              <h3 className="text-2xl font-serif font-medium text-on-surface mb-3 tracking-tight">
                Delete Library
              </h3>
              <p className="text-on-surface-variant mb-8 text-sm leading-relaxed">
                Are you sure you want to delete this entire library? This action
                cannot be undone and all books will be lost.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setLibraryToDelete(false)}
                  className="px-5 py-3 text-on-surface font-medium hover:bg-surface-container border border-outline-variant/30 rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteLibrary}
                  className="px-5 py-3 bg-error text-on-error hover:bg-error/90 rounded-xl transition-colors font-medium text-sm shadow-sm"
                >
                  Delete Library
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

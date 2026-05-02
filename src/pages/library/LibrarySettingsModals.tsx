import React from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {X, Share2, Settings, Download, Trash2} from 'lucide-react';
import {Library} from '../../types';

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
  return (
    <>
      <AnimatePresence>
        {isSettingsOpen && isOwner && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-border/50"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-ink">
                  <div className="w-10 h-10 bg-paper rounded-full flex items-center justify-center text-accent border border-border/50">
                    <Share2 size={20} />
                  </div>
                  Share & Settings
                </h3>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2.5 text-muted hover:bg-paper rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mb-10">
                <h4 className="text-sm font-medium text-muted mb-4 uppercase tracking-wider">
                  Share Access
                </h4>
                <form onSubmit={handleShare} className="flex gap-3 mb-6">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={e => setShareEmail(e.target.value)}
                    placeholder="friend@email.com"
                    className="flex-1 bg-paper border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
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
                    <div className="bg-paper border border-border/50 rounded-xl p-4 text-center">
                      <p className="text-sm text-muted">
                        Not shared with anyone yet.
                      </p>
                    </div>
                  ) : (
                    library.sharedWith.map(email => (
                      <div
                        key={email}
                        className="flex items-center justify-between bg-paper border border-border/50 px-4 py-3 rounded-xl text-sm group hover:border-border transition-colors"
                      >
                        <span className="truncate mr-3 font-medium text-ink">
                          {email}
                        </span>
                        <button
                          onClick={() => handleRemoveShare(email)}
                          className="text-muted hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
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
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
            onClick={() => setIsAdvancedSettingsOpen(false)}
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-border/50"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-ink">
                  <div className="w-10 h-10 bg-paper rounded-full flex items-center justify-center text-accent border border-border/50">
                    <Settings size={20} />
                  </div>
                  Advanced Settings
                </h3>
                <button
                  onClick={() => setIsAdvancedSettingsOpen(false)}
                  className="p-2.5 text-muted hover:bg-paper rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mb-10">
                <h4 className="text-sm font-medium text-muted mb-4 uppercase tracking-wider">
                  Export Data
                </h4>
                <button
                  onClick={handleExportToCSV}
                  className="w-full flex items-center justify-center gap-2 bg-paper text-ink border border-border px-5 py-4 rounded-xl hover:bg-surface transition-colors text-sm font-medium shadow-sm"
                >
                  <Download size={18} /> Export to CSV (Google Sheets)
                </button>
                <p className="text-xs text-muted mt-3 text-center">
                  Download your library as a CSV file to import into Google
                  Sheets or Excel.
                </p>
              </div>
              {isOwner && (
                <div className="pt-8 border-t border-border/50">
                  <h4 className="text-sm font-medium text-red-500 mb-4 uppercase tracking-wider">
                    Danger Zone
                  </h4>
                  <button
                    onClick={handleDeleteLibrary}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 border border-red-100 px-5 py-4 rounded-xl hover:bg-red-100 transition-colors text-sm font-medium"
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
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans"
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0, y: 10}}
              animate={{scale: 1, opacity: 1, y: 0}}
              exit={{scale: 0.95, opacity: 0, y: 10}}
              className="bg-surface rounded-[32px] p-8 max-w-sm w-full shadow-xl border border-border/50"
            >
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-5 border border-red-100">
                <Trash2 size={24} />
              </div>
              <h3 className="text-2xl font-serif font-medium text-ink mb-3 tracking-tight">
                Delete Library
              </h3>
              <p className="text-muted mb-8 text-sm leading-relaxed">
                Are you sure you want to delete this entire library? This action
                cannot be undone and all books will be lost.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setLibraryToDelete(false)}
                  className="px-5 py-3 text-ink font-medium hover:bg-paper border border-border rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteLibrary}
                  className="px-5 py-3 bg-red-500 text-white hover:bg-red-600 rounded-xl transition-colors font-medium text-sm shadow-sm"
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

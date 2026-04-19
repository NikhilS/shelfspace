import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, BookOpen } from 'lucide-react';
import { BookDetails } from '../services/bookApi';
import { generateLibraryRecommendations } from '../services/gemini';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

interface RecommendationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  libraryBooks: { title: string; author: string }[];
}

export default function RecommendationsModal({ isOpen, onClose, libraryBooks }: RecommendationsModalProps) {
  const [recommendations, setRecommendations] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = React.useRef(false);

  useEffect(() => {
    if (isOpen && !recommendations && !isGeneratingRef.current && libraryBooks.length > 0) {
      generateRecommendations();
    }
  }, [isOpen, recommendations, libraryBooks.length]);

  const generateRecommendations = async () => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    try {
      const content = await generateLibraryRecommendations(libraryBooks);
      setRecommendations(content);
    } catch (error) {
      console.error("Failed to generate recommendations:", error);
      setRecommendations("Failed to generate recommendations. Please try again later.");
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans" 
          onClick={onClose}
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="bg-paper rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-surface px-8 py-6 border-b border-border flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent text-white rounded-xl">
              <Sparkles size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-serif font-bold text-ink">AI Recommendations</h2>
              <p className="text-sm text-muted">Based on your current library</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-muted hover:bg-paper rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-8 overflow-y-auto flex-1">
          {libraryBooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted text-center">
              <BookOpen size={48} className="mb-4 opacity-20" />
              <p className="text-lg font-serif">Your library is empty.</p>
              <p className="text-sm">Add some books to get personalized recommendations!</p>
            </div>
          ) : isGenerating ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted">
              <Loader2 className="animate-spin mb-4 text-accent" size={48} />
              <p className="text-lg font-serif font-medium text-ink">Analyzing your reading history...</p>
              <p className="text-sm mt-2">The AI Librarian is finding the perfect books for you.</p>
            </div>
          ) : recommendations ? (
            <div className="prose prose-sm sm:prose-base max-w-none prose-headings:font-serif prose-headings:text-ink prose-p:text-ink/80 prose-a:text-accent prose-strong:text-ink">
              <Markdown>{recommendations}</Markdown>
            </div>
          ) : null}
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

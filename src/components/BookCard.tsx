import React from 'react';
import { BookDetails } from '../services/bookApi';
import { Book as BookIcon } from 'lucide-react';
import { toTitleCase } from '../lib/utils';

interface BookCardProps {
  key?: React.Key;
  book: BookDetails & { id: string, addedBy: string, addedAt: any };
  onDelete?: (id: string) => void;
  onClick?: () => void;
  canEdit: boolean;
}

const getHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const gradients = [
  'from-[#fef08a] to-[#fef9c3]', // Pastel Yellow
  'from-[#bbf7d0] to-[#dcfce7]', // Pastel Green
  'from-[#a7f3d0] to-[#d1fae5]', // Pastel Emerald
  'from-[#d9f99d] to-[#ecfccb]', // Pastel Lime
  'from-[#fde047] to-[#fef08a]', // Sunny Yellow
  'from-[#86efac] to-[#bbf7d0]', // Mint Green
  'from-[#fef08a] to-[#dcfce7]', // Yellow to Green
];

export default function BookCard({ book, onDelete, onClick, canEdit }: BookCardProps) {
  const hash = getHash(book.title || '');
  const gradientClass = gradients[hash % gradients.length];

  return (
    <div 
      onClick={onClick}
      className={`group relative w-32 h-48 sm:w-40 sm:h-56 rounded-r-xl rounded-l-sm shadow-md transition-all duration-400 ease-out hover:-translate-y-4 hover:shadow-2xl hover:shadow-accent/20 hover:rotate-1 cursor-pointer flex-shrink-0 ring-1 ring-black/5 hover:ring-accent/40`}
    >
      {/* Book Spine Effect */}
      <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/20 via-black/5 to-transparent rounded-l-sm z-10" />
      <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-white/50 z-20" />
      <div className="absolute left-2 top-0 bottom-0 w-[1px] bg-black/5 z-20" />
      
      {/* Book Cover / Spine */}
      <div 
        className={`w-full h-full rounded-r-xl rounded-l-sm overflow-hidden relative ${!book.coverUrl ? `bg-gradient-to-br ${gradientClass}` : 'bg-surface'}`}
      >
        {book.coverUrl ? (
          <img 
            src={book.coverUrl} 
            alt={book.title}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 p-4 pl-6 flex flex-col justify-between text-ink">
            <div className="space-y-2">
              <div className="w-8 h-[2px] bg-ink/30 mb-2" />
              <h3 className="font-serif font-bold text-sm sm:text-base leading-snug line-clamp-4 tracking-tight">
                {toTitleCase(book.title)}
              </h3>
              <p className="font-sans text-xs sm:text-sm text-ink/70 line-clamp-2 font-bold tracking-wide uppercase">
                {toTitleCase(book.author)}
              </p>
            </div>
            <div className="flex justify-between items-end">
              <BookIcon size={16} className="text-ink/30" strokeWidth={1.5} />
              <div className="w-4 h-4 rounded-full border border-ink/20 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-ink/20 rounded-full" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Button */}
      {canEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(book.id);
          }}
          className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md z-30 hover:bg-red-600 hover:scale-110"
        >
          &times;
        </button>
      )}
    </div>
  );
}

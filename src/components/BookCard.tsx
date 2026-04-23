import React from 'react';
import { BookDetails } from '../services/bookApi';
import { Book as BookIcon } from 'lucide-react';
import { toTitleCase } from '../lib/utils';

import { Timestamp } from 'firebase/firestore';

type FirestoreDate = Timestamp | Date | string | number;

interface BookCardProps {
  key?: React.Key;
  book: BookDetails & { id: string, addedBy: string, addedAt: FirestoreDate };
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
      className={`group cursor-pointer flex flex-col h-full`}
    >
      {/* Book Cover */}
      <div 
        className={`relative aspect-[2/3] mb-4 bg-surface-container-high rounded-sm shadow-[0_4px_12px_rgba(26,47,75,0.08)] overflow-hidden transform transition-transform duration-300 group-hover:-translate-y-1 ${!book.coverUrl ? `bg-gradient-to-br ${gradientClass}` : 'bg-surface'}`}
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
        
        <div className="absolute inset-0 bg-gradient-to-t from-inverse-surface/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
          <button className="w-full py-2 bg-surface text-on-surface font-label-caps text-label-caps rounded-DEFAULT hover:bg-surface-bright transition-colors">View Details</button>
        </div>

        {/* Delete Button */}
        {canEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(book.id);
            }}
            className="absolute top-2 right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md z-30 hover:bg-red-600 hover:scale-110"
          >
            &times;
          </button>
        )}
      </div>

      {/* Book Metadata */}
      <div className="mt-auto">
        <h3 className="font-headline-md text-headline-md text-on-surface line-clamp-1 tracking-tight">{toTitleCase(book.title)}</h3>
        <p className="font-body-md text-body-md text-on-surface-variant line-clamp-1">{toTitleCase(book.author)}</p>
      </div>
    </div>
  );
}

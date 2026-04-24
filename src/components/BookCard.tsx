import React from 'react';
import { BookDetails } from '../services/bookApi';
import { Book as BookIcon } from 'lucide-react';
import { toTitleCase } from '../lib/utils';

import { Timestamp } from 'firebase/firestore';

type FirestoreDate = Timestamp | Date | string | number;

interface BookCardProps {
  key?: React.Key;
  book: BookDetails & { id: string, addedBy: string, addedAt: FirestoreDate };
  onClick?: () => void;
  canEdit: boolean;
}

export default function BookCard({ book, onClick, canEdit }: BookCardProps) {
  return (
    <div 
      onClick={onClick}
      className={`group cursor-pointer flex flex-col h-full`}
    >
      {/* Book Cover */}
      <div 
        className={`relative aspect-[2/3] mb-4 bg-surface-container rounded-lg shadow-[0_4px_12px_rgba(26,47,75,0.08)] overflow-hidden transform transition-transform duration-300 group-hover:-translate-y-1`}
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
          <div className="absolute inset-0 p-4 pl-6 flex flex-col justify-between text-on-surface bg-surface-variant border-l-4 border-primary/20">
            <div className="space-y-2 max-h-[80%] overflow-hidden">
              <div className="w-8 h-[2px] bg-primary/30 mb-2" />
              <h3 className="font-serif font-bold text-sm sm:text-base leading-snug tracking-tight text-primary">
                {toTitleCase(book.title)}
              </h3>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant font-medium tracking-wide uppercase mt-1">
                {toTitleCase(book.author)}
              </p>
            </div>
            <div className="flex justify-between items-end">
              <BookIcon size={16} className="text-primary/40" strokeWidth={1.5} />
            </div>
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
          <button className="w-full py-2 bg-transparent border border-on-primary text-on-primary font-label-caps text-label-caps rounded hover:bg-on-primary hover:text-primary transition-colors">VIEW DETAILS</button>
        </div>
      </div>

      {/* Book Metadata */}
      <div className="mt-auto pl-1 pr-1">
        <h3 className="font-headline-md text-base leading-tight text-on-surface line-clamp-1 tracking-tight">{toTitleCase(book.title)}</h3>
        <p className="font-body-md text-sm text-on-surface-variant line-clamp-1 mt-1">{toTitleCase(book.author)}</p>
      </div>
    </div>
  );
}

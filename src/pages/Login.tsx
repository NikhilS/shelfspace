import React from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate} from 'react-router-dom';
import {motion} from 'motion/react';
import {ArrowRight, BookOpen, Library, Camera, Compass} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/book/BookLoader';

import {HeroShowcaseCard} from './marketing/HeroShowcaseCard';
import {DimensionsBento} from './marketing/DimensionsBento';

export default function Login() {
  const {user, isAuthReady, signIn} = useAuth();

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-on-background">
        <BookLoader
          size="lg"
          className="mb-4 animate-in fade-in zoom-in-95 duration-500"
        />
        <span className="metadata-eyebrow text-on-surface-variant animate-pulse">
          Opening your shelves...
        </span>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="bg-background text-on-background font-body-md text-body-md antialiased selection:bg-primary/20 selection:text-primary min-h-screen flex flex-col overflow-x-hidden">
      {/* Top Header — Matches signed-in AppLayout */}
      <header className="sticky top-0 w-full z-30 bg-background/92 backdrop-blur-xl border-b border-outline-variant/60 transition-all">
        <div className="flex justify-between items-center h-16 px-4 sm:px-6 lg:px-8 w-full max-w-[1280px] mx-auto gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-brand italic text-2xl sm:text-[28px] font-bold tracking-tight text-primary leading-none select-none inline-flex items-center">
              book(ish)
            </span>
            <span
              className="hidden sm:inline-block h-4 w-px bg-outline-variant/70 shrink-0 self-center"
              aria-hidden="true"
            />
            <span className="hidden sm:inline-flex items-center font-sans font-semibold text-[11px] tracking-widest uppercase text-on-surface-variant select-none leading-none">
              Shelves & Reading Life
            </span>
          </div>

          <div className="flex items-center shrink-0">
            <Button
              type="button"
              onClick={signIn}
              variant="editorial"
              className="bg-primary text-on-primary hover:bg-primary/90 font-sans text-xs sm:text-sm font-semibold px-4 sm:px-5 rounded-lg shadow-elevation-1"
            >
              <span>Sign In</span>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center w-full">
        {/* SECTION 1: HERO + INTERACTIVE MINI BENTO PREVIEW */}
        <section className="w-full max-w-[1200px] px-6 sm:px-12 pt-12 sm:pt-16 pb-14 sm:pb-20 flex flex-col items-center text-center">
          <motion.div
            initial={{opacity: 0, y: 14}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.45, ease: 'easeOut'}}
            className="flex flex-col items-center w-full"
          >
            {/* Light, Informal Headline */}
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-on-surface leading-[1.08] tracking-tight max-w-3xl">
              Your physical bookshelves and your reading life,{' '}
              <span className="font-brand italic font-bold text-primary">
                finally in the same room.
              </span>
            </h1>

            {/* Crisp Subtitle */}
            <p className="font-sans text-base sm:text-lg text-on-surface-variant max-w-2xl leading-relaxed mt-4">
              Catalog the books on your shelves at home and track everything
              you’re reading, borrowing, or saving for later—with 1-click
              search, shelf photo scanning, and visual maps of your books.
            </p>

            {/* Quick Capability Strip */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 text-xs text-on-surface-variant font-sans font-medium">
              <span className="inline-flex items-center gap-1.5">
                <Library className="w-3.5 h-3.5 text-primary" />
                Physical libraries + personal reading list
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-primary" />
                Search, barcode scan & shelf camera
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-primary" />
                3D stack, constellations, map & timeline
              </span>
            </div>

            {/* Interactive Mini App Bento Showcase */}
            <HeroShowcaseCard />
          </motion.div>
        </section>

        {/* SECTION 2: VISUAL 4-CARD FEATURE BENTO GRID */}
        <DimensionsBento />

        {/* SECTION 3: CLOSING SIGN-IN CTA */}
        <section className="w-full py-16 sm:py-20 border-t border-outline-variant/40">
          <div className="max-w-3xl mx-auto px-6 sm:px-12">
            <div className="rounded-2xl bg-surface border border-outline-variant/60 p-8 sm:p-10 text-center shadow-elevation-2 flex flex-col items-center">
              <div className="w-11 h-11 rounded-xl bg-surface-container border border-outline-variant/50 flex items-center justify-center text-primary mb-4">
                <BookOpen className="w-5 h-5" />
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">
                Start your first shelf in 30 seconds.
              </h2>
              <p className="font-sans text-sm sm:text-base text-on-surface-variant max-w-md mt-2 leading-relaxed">
                Sign in with Google to track what you’re reading right now,
                search for a book, or snap a photo of a bookshelf.
              </p>
              <div className="mt-6">
                <Button
                  type="button"
                  onClick={signIn}
                  variant="editorial"
                  size="lg"
                  className="bg-primary text-on-primary hover:bg-primary/90 h-12 px-7 rounded-xl font-sans text-sm font-semibold flex items-center gap-2 shadow-elevation-1"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Minimal Footer */}
      <footer className="py-8 border-t border-outline-variant/40 bg-surface-container-low/50">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-sans text-on-surface-variant">
          <div className="flex items-center gap-2.5">
            <span className="font-brand italic text-lg font-bold text-primary leading-none">
              book(ish)
            </span>
            <span className="text-outline-variant">·</span>
            <span>For people who love their bookshelves</span>
          </div>
          <span>© {new Date().getFullYear()} book(ish)</span>
        </div>
      </footer>
    </div>
  );
}

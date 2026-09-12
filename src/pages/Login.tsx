import React from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate} from 'react-router-dom';
import {motion} from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  Database,
  BookOpen,
  ScanBarcode,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/BookLoader';

// Subcomponents
import {HeroShowcaseCard} from './marketing/HeroShowcaseCard';
import {IngestionRibbon} from './marketing/IngestionRibbon';
import {DimensionsBento} from './marketing/DimensionsBento';
import {CuratorSpotlightSection} from './marketing/CuratorSpotlightSection';
import {ComparisonTable} from './marketing/ComparisonTable';

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
          Consulting Archives...
        </span>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="bg-background text-on-background antialiased selection:bg-secondary/20 selection:text-secondary min-h-screen flex flex-col overflow-x-hidden">
      {/* Navigation */}
      <nav className="bg-surface/90 backdrop-blur-md text-on-surface w-full top-0 sticky border-b border-outline-variant/30 z-50 flex justify-between items-center px-6 sm:px-12 py-4 transition-all">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-2xl font-bold tracking-tight text-primary leading-none">
              book(ish)
            </span>
            <span className="font-label-caps-xs text-[9px] text-on-surface-variant/70 uppercase tracking-widest font-semibold mt-0.5">
              Physical Vault Archive
            </span>
          </div>
        </div>

        {/* Center Desktop Links */}
        <div className="hidden lg:flex items-center gap-8 text-xs font-sans font-medium text-on-surface-variant">
          <a href="#ingestion" className="hover:text-primary transition-colors">
            Ingestion Speed
          </a>
          <a
            href="#dimensions"
            className="hover:text-primary transition-colors"
          >
            The Dimensions
          </a>
          <a href="#curator" className="hover:text-primary transition-colors">
            AI Curator
          </a>
          <a href="#compare" className="hover:text-primary transition-colors">
            Why book(ish)
          </a>
        </div>

        {/* Action CTAs */}
        <div className="flex items-center gap-3">
          <Button
            onClick={signIn}
            variant="ghost"
            className="hidden sm:flex text-on-surface-variant hover:text-primary hover:bg-surface-container font-label-caps-sm text-label-caps-sm font-bold uppercase tracking-wider"
          >
            Sign-In
          </Button>
          <Button
            onClick={signIn}
            className="bg-secondary hover:bg-secondary/90 text-on-secondary font-label-caps-sm text-label-caps-sm font-bold uppercase tracking-wider px-5 sm:px-6 shadow-elevation-1 hover:shadow-elevation-2 transition-all rounded-full"
          >
            Get Started
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col items-center w-full">
        {/* HERO SECTION */}
        <section className="w-full max-w-[1200px] px-6 sm:px-12 pt-16 sm:pt-24 pb-16 lg:pb-24 flex flex-col items-center text-center">
          <motion.div
            initial={{opacity: 0, y: 20}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.6, ease: 'easeOut'}}
            className="flex flex-col items-center w-full"
          >
            {/* Archival Eyebrow */}
            <div className="inline-flex items-center gap-2 bg-secondary/10 border border-secondary/20 px-4 py-1.5 rounded-full mb-8">
              <Sparkles className="w-3.5 h-3.5 text-secondary" />
              <span className="font-label-caps-sm text-[11px] text-secondary font-bold uppercase tracking-widest">
                Archival Intelligence for Physical Collectors
              </span>
            </div>

            {/* Display Headline */}
            <h1 className="font-serif text-4xl sm:text-6xl lg:text-7xl font-bold text-primary leading-[1.08] tracking-tight max-w-4xl">
              The digital ledger your <br className="hidden sm:block" />
              <span className="italic font-serif font-semibold text-secondary">
                physical library deserves
              </span>
              .
            </h1>

            {/* Subtitle */}
            <p className="font-sans text-base sm:text-lg text-on-surface-variant max-w-2xl leading-relaxed mt-6">
              Catalog hundreds of physical volumes in minutes. Rediscover your
              shelves through 3D thematic constellations, narrative geography
              maps, deep-time timelines, and an autonomous AI literary curator.
            </p>

            {/* Hero CTAs */}
            <div className="flex flex-col sm:flex-row items-center gap-4 mt-10 w-full sm:w-auto">
              <Button
                onClick={signIn}
                className="bg-secondary hover:bg-secondary/90 text-on-secondary h-14 px-8 sm:px-10 rounded-full font-label-caps font-bold uppercase tracking-wider flex items-center justify-center gap-3 shadow-elevation-2 hover:-translate-y-0.5 transition-all w-full sm:w-auto"
              >
                <Database className="w-5 h-5 text-on-secondary/80" />
                Open Your Vault
              </Button>
            </div>

            {/* Reassurance Badges */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-6 text-xs text-on-surface-variant font-sans">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Continuous Spine & Barcode Ingest
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                1-Click Goodreads Migration
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Private & Free for Collectors
              </span>
            </div>

            {/* Interactive Showcase Card */}
            <HeroShowcaseCard />
          </motion.div>
        </section>

        {/* INGESTION SPEED SECTION */}
        <div id="ingestion" className="w-full">
          <IngestionRibbon />
        </div>

        {/* DIMENSIONS BENTO SECTION */}
        <div id="dimensions" className="w-full">
          <DimensionsBento />
        </div>

        {/* AI CURATOR SECTION */}
        <div id="curator" className="w-full">
          <CuratorSpotlightSection />
        </div>

        {/* COMPARISON MATRIX */}
        <div id="compare" className="w-full">
          <ComparisonTable />
        </div>

        {/* FINAL CONVERSION SECTION */}
        <section className="w-full py-28 sm:py-36 bg-surface-container-low/40 border-t border-outline-variant/30 relative overflow-hidden">
          <div className="max-w-[800px] mx-auto px-6 text-center relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-surface-container-lowest rounded-3xl flex items-center justify-center mb-8 border border-outline-variant/40 shadow-elevation-1 text-secondary">
              <ScanBarcode className="w-8 h-8" />
            </div>

            <h2 className="font-serif text-4xl sm:text-5xl font-bold text-primary max-w-2xl mx-auto leading-[1.15] tracking-tight">
              Give your physical library the home it deserves.
            </h2>

            <p className="font-sans text-base sm:text-lg text-on-surface-variant max-w-md mx-auto leading-relaxed mt-6">
              Connect securely with Google to scan your first shelf, run the
              Spruce-Up engine, and explore your collection in 3D.
            </p>

            <div className="pt-10 flex flex-col items-center gap-4">
              <Button
                onClick={signIn}
                className="bg-secondary hover:bg-secondary/90 text-on-secondary font-label-caps font-bold uppercase tracking-wider h-14 px-10 rounded-full shadow-elevation-2 hover:shadow-elevation-3 hover:-translate-y-0.5 transition-all flex items-center gap-3"
              >
                Sign In & Start Scanning
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <span className="text-xs text-on-surface-variant/70 font-sans">
                No credit card required • Instant setup • 100% Free
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-surface-container py-12 border-t border-outline-variant/30">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex items-center gap-3 justify-center sm:justify-start">
            <div className="w-7 h-7 rounded-lg bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="font-serif text-xl font-bold text-primary">
              book(ish)
            </span>
            <span className="font-label-caps-xs text-[10px] text-on-surface-variant/70 uppercase tracking-widest font-semibold ml-3 border-l border-outline-variant/40 pl-3">
              Physical Library Architecture
            </span>
          </div>

          <div className="text-xs font-sans text-on-surface-variant/80 flex items-center gap-6">
            <span>© {new Date().getFullYear()} book(ish)</span>
            <span>Crafted for Physical Book Collectors</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

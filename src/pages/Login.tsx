import React from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate} from 'react-router-dom';
import {motion} from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  Database,
  BookOpen,
  Map,
  Clock,
  Network,
  ScanBarcode,
  Check,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/BookLoader';

export default function Login() {
  const {user, isAuthReady, signIn} = useAuth();

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-on-background">
        <BookLoader
          size="lg"
          className="mb-4 animate-in fade-in zoom-in-95 duration-500"
        />
        <span className="font-sans text-[10px] font-bold tracking-[0.2em] text-on-surface-variant uppercase animate-pulse">
          Consulting Archives...
        </span>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="bg-background text-on-background antialiased selection:bg-primary-container selection:text-on-primary-container min-h-screen flex flex-col overflow-hidden">
      {/* Navigation */}
      <nav className="bg-surface/80 backdrop-blur-md text-on-surface w-full top-0 sticky border-b border-outline-variant/30 z-50 flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-secondary" />
          <span className="font-serif text-2xl font-bold tracking-tight text-primary">
            book(ish)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={signIn}
            variant="ghost"
            className="hidden sm:flex text-on-surface-variant hover:text-primary hover:bg-surface-container font-sans text-xs font-bold uppercase tracking-wider"
          >
            Sign-In
          </Button>
          <Button
            onClick={signIn}
            className="bg-secondary hover:bg-secondary/90 text-on-secondary font-sans text-[10px] sm:text-xs font-bold uppercase tracking-wider px-4 sm:px-6 shadow-elevation-1 hover:shadow-elevation-2 transition-all rounded-full"
          >
            Get Started
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col items-center w-full">
        {/* HERO SECTION */}
        <section className="w-full max-w-[1200px] px-6 sm:px-12 py-20 lg:py-32 flex flex-col items-center text-center">
          <motion.div
            initial={{opacity: 0, y: 20}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.6, ease: 'easeOut'}}
            className="flex flex-col items-center"
          >
            <div className="inline-flex items-center gap-2 bg-secondary/10 border border-secondary/20 px-4 py-1.5 rounded-full mb-8">
              <Sparkles className="w-3.5 h-3.5 text-secondary" />
              <span className="font-sans text-[10px] font-bold tracking-widest text-secondary uppercase">
                Now featuring Gemini AI Insights
              </span>
            </div>

            <h1 className="font-serif text-5xl sm:text-6xl lg:text-7xl font-bold text-primary leading-[1.05] tracking-tight max-w-4xl">
              Your physical library, <br className="hidden sm:block" />
              <span className="italic font-serif font-semibold text-secondary">
                beautifully untangled
              </span>
              .
            </h1>

            <p className="font-sans text-base sm:text-lg text-on-surface-variant max-w-2xl leading-relaxed mt-8 bg-surface-container-low/50 border border-outline-variant/30 p-6 sm:p-8 rounded-2xl shadow-sm backdrop-blur-sm">
              book(ish) is a tailored digital ledger for physical bookkeepers.
              Automatically scan barcodes, generate relational semantic
              networks, plot stories geographically, and curate your metadata
              perfectly.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto mt-12">
              <Button
                onClick={signIn}
                className="bg-secondary hover:bg-secondary/90 text-on-secondary h-14 px-10 rounded-full font-sans font-bold text-[11px] sm:text-sm uppercase tracking-wider flex items-center justify-center gap-3 shadow-elevation-2 hover:-translate-y-0.5 transition-all"
              >
                <Database className="w-5 h-5 text-on-secondary/80" />
                Open Your Vault
              </Button>
            </div>
          </motion.div>
        </section>

        {/* BENTO FEATURE GRID */}
        <section className="w-full bg-surface-container-low/30 py-24 border-y border-outline-variant/30">
          <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="font-sans text-[10px] font-bold tracking-widest text-secondary uppercase block mb-3">
                Architectural Capabilities
              </span>
              <h2 className="font-serif text-3xl sm:text-4xl font-bold text-primary tracking-tight">
                Not just shelves. Dimensions.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-[minmax(320px,auto)]">
              {/* Feature 1: Semantic Constellations (Large Square) */}
              <motion.div
                initial={{opacity: 0, y: 30}}
                whileInView={{opacity: 1, y: 0}}
                viewport={{once: true, margin: '-100px'}}
                className="md:col-span-8 bg-primary rounded-3xl overflow-hidden relative shadow-elevation-2 group border border-primary-container min-h-[380px]"
              >
                <div className="absolute inset-0 bg-radial-gradient opacity-40 transition-opacity group-hover:opacity-60" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 transform group-hover:scale-105 transition-transform duration-1000">
                  <Network
                    className="w-64 h-64 text-secondary-container"
                    strokeWidth={1}
                  />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-10 z-20 bg-gradient-to-t from-primary via-primary/80 to-transparent">
                  <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-white/20">
                    <Network className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-serif text-3xl font-bold text-white mb-3 tracking-tight">
                    Semantic Constellations
                  </h3>
                  <p className="font-sans text-sm sm:text-base text-white/80 max-w-lg leading-relaxed">
                    Break free from rigid genres. Our AI maps your books into a
                    3D interactive universe based on literary themes, tonal
                    similarities, and underlying philosophies.
                  </p>
                </div>
              </motion.div>

              {/* Feature 2: Spruce Up (Tall Rectangle) */}
              <motion.div
                initial={{opacity: 0, y: 30}}
                whileInView={{opacity: 1, y: 0}}
                viewport={{once: true, margin: '-100px'}}
                transition={{delay: 0.1}}
                className="md:col-span-4 bg-surface-container rounded-3xl overflow-hidden relative shadow-elevation-1 border border-outline-variant/40 group hover:shadow-elevation-2 transition-all p-8 flex flex-col justify-between min-h-[380px]"
              >
                <div>
                  <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-secondary/20 transition-transform group-hover:scale-110">
                    <Sparkles className="w-5 h-5 text-secondary" />
                  </div>
                  <h3 className="font-serif text-2xl font-bold text-primary mb-3 tracking-tight">
                    The Spruce-Up Engine
                  </h3>
                  <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                    Automatically backfill missing metadata, resolve duplicates,
                    and heal cover artwork utilizing Gemini's continuous
                    background processing.
                  </p>
                </div>

                <div className="mt-8 bg-surface-container-high border border-outline-variant/30 rounded-2xl p-5 shadow-inner space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center border border-success/30">
                      <Check className="w-3.5 h-3.5 text-success" />
                    </div>
                    <span className="font-sans text-[11px] uppercase tracking-wider text-primary font-bold">
                      12 Covers Fixed
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center border border-success/30">
                      <Check className="w-3.5 h-3.5 text-success" />
                    </div>
                    <span className="font-sans text-[11px] uppercase tracking-wider text-primary font-bold">
                      3 Duplicates Merged
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Feature 3: World Map (Rectangle) */}
              <motion.div
                initial={{opacity: 0, y: 30}}
                whileInView={{opacity: 1, y: 0}}
                viewport={{once: true, margin: '-100px'}}
                transition={{delay: 0.2}}
                className="md:col-span-5 lg:col-span-4 bg-surface-container rounded-3xl overflow-hidden relative shadow-elevation-1 border border-outline-variant/40 group hover:shadow-elevation-2 transition-all p-8 flex flex-col"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-primary/20 transition-transform group-hover:scale-110">
                  <Map className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-serif text-2xl font-bold text-primary mb-3 tracking-tight flex-shrink-0">
                  Geographic Context
                </h3>
                <p className="font-sans text-sm text-on-surface-variant leading-relaxed flex-grow">
                  Pinpoint where every story takes place. A beautifully
                  interactive global map tracks the physical settings of your
                  entire library automatically.
                </p>
                <div className="mt-6 w-full h-24 bg-[url('https://www.transparenttextures.com/patterns/cartographer.png')] opacity-20 rounded-xl" />
              </motion.div>

              {/* Feature 4: Timeline (Rectangle) */}
              <motion.div
                initial={{opacity: 0, y: 30}}
                whileInView={{opacity: 1, y: 0}}
                viewport={{once: true, margin: '-100px'}}
                transition={{delay: 0.3}}
                className="md:col-span-7 lg:col-span-8 bg-auth-card rounded-3xl overflow-hidden relative shadow-elevation-1 border border-outline-variant/40 group hover:shadow-elevation-2 transition-all p-8 sm:p-10 border-l-4 border-l-secondary flex flex-col sm:flex-row items-center gap-8"
              >
                <div className="flex-1">
                  <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center mb-6 shadow-inner border border-secondary/20 transition-transform group-hover:scale-110">
                    <Clock className="w-5 h-5 text-secondary" />
                  </div>
                  <h3 className="font-serif text-3xl font-bold text-primary mb-3 tracking-tight">
                    Chronological Sync
                  </h3>
                  <p className="font-sans text-sm sm:text-base text-on-surface-variant/90 leading-relaxed max-w-md">
                    Journey through centuries. View when your stories happen on
                    an interactive timeline, from ancient history to distant
                    sci-fi futures, automatically inferred from the text.
                  </p>
                </div>
                <div className="w-full sm:w-2/5 aspect-video sm:aspect-auto sm:h-full bg-surface-container border border-outline-variant/30 rounded-2xl flex items-center justify-center p-6 shadow-inner relative overflow-hidden group-hover:border-outline-variant/50 transition-colors">
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
                    <Clock className="w-48 h-48 text-primary" strokeWidth={1} />
                  </div>
                  <div className="w-full h-1 bg-outline-variant/50 relative rounded-full">
                    <div className="absolute top-1/2 left-[20%] w-3.5 h-3.5 bg-primary rounded-full transform -translate-y-1/2 shadow-sm border-2 border-white/80" />
                    <div className="absolute top-1/2 left-[50%] w-3.5 h-3.5 bg-secondary rounded-full transform -translate-y-1/2 shadow-sm border-2 border-white/80" />
                    <div className="absolute top-1/2 left-[80%] w-3.5 h-3.5 bg-tertiary-base rounded-full transform -translate-y-1/2 shadow-sm border-2 border-white/80" />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* BOTTOM CALL TO ACTION */}
        <section className="w-full bg-background py-32 border-t border-outline-variant/30 relative overflow-hidden">
          <div className="max-w-[800px] mx-auto px-6 text-center relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 bg-surface-container rounded-3xl flex items-center justify-center mb-8 border border-outline-variant/40 shadow-elevation-1">
              <ScanBarcode className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-serif text-4xl sm:text-5xl font-bold text-primary max-w-2xl mx-auto leading-[1.1] tracking-tight">
              Begin archiving your collection
            </h2>
            <p className="font-sans text-base sm:text-lg text-on-surface-variant max-w-md mx-auto leading-relaxed mt-6">
              Log in securely with Google to immediately scan your first book
              and generate your semantic layout.
            </p>
            <div className="pt-12">
              <Button
                onClick={signIn}
                className="bg-secondary hover:bg-secondary/90 text-on-secondary font-sans text-[11px] sm:text-sm uppercase tracking-wider font-bold h-14 px-8 sm:px-10 rounded-full shadow-elevation-2 hover:shadow-elevation-3 hover:-translate-y-0.5 transition-all mx-auto flex items-center gap-3"
              >
                Sign In & Start Scanning
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-surface-container-low py-10 border-t border-outline-variant/30">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex items-center gap-2 justify-center sm:justify-start">
            <BookOpen className="w-4 h-4 text-secondary" />
            <span className="font-serif text-lg font-bold text-primary">
              book(ish)
            </span>
            <span className="text-[10px] text-on-surface-variant/60 ml-3 uppercase tracking-widest font-bold">
              © {new Date().getFullYear()} Archive Systems
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

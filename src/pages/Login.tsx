import React, {useState, useEffect} from 'react';
import {useAuth} from '../contexts/AuthContext';
import {Navigate} from 'react-router-dom';
import {motion, AnimatePresence} from 'motion/react';
import {
  ScanBarcode,
  Camera,
  ArrowRight,
  Sparkles,
  Database,
  Compass,
  AlertTriangle,
  RotateCcw,
  Check,
  BookOpen,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../components/BookLoader';

// Mock Book data for the Constellation Demo
const CONSTELLATION_BOOKS = [
  {
    id: '1',
    title: 'The Secret History',
    author: 'Donna Tartt',
    x: 25,
    y: 30,
    genre: 'Dark Academia',
    color: '#7d5633',
  },
  {
    id: '2',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    x: 45,
    y: 75,
    genre: 'Stoic Philosophy',
    color: '#021a35',
  },
  {
    id: '3',
    title: 'Dune',
    author: 'Frank Herbert',
    x: 75,
    y: 25,
    genre: 'Sci-Fi Classic',
    color: '#001f14',
  },
  {
    id: '4',
    title: 'The Republic',
    author: 'Plato',
    x: 20,
    y: 80,
    genre: 'Political Philosophy',
    color: '#ba1a1a',
  },
  {
    id: '5',
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    x: 80,
    y: 70,
    genre: 'Tragic Classics',
    color: '#7d5633',
  },
];

// Mock Scanned Books feed
const INITIAL_SCANNED_ITEMS = [
  {
    isbn: '9780143110873',
    title: 'The Secret History',
    author: 'Donna Tartt',
    status: 'verified',
    cover: '📖',
  },
  {
    isbn: '9780451528650',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    status: 'verified',
    cover: '✒️',
  },
];

export default function Login() {
  const {user, isAuthReady, signIn} = useAuth();
  const [activeDemoTab, setActiveDemoTab] = useState<
    'constellation' | 'scanner' | 'curator' | 'integrity'
  >('constellation');

  // Constellation hovered book state
  const [hoveredBook, setHoveredBook] = useState<
    (typeof CONSTELLATION_BOOKS)[0] | null
  >(null);

  // Scanner Simulator state
  const [scannerQueue, setScannerQueue] = useState(INITIAL_SCANNED_ITEMS);
  const [isScanning, setIsScanning] = useState(false);
  const [lasersOn, setLasersOn] = useState(true);

  // Integrity Spruce-up simulator state
  const [integrityState, setIntegrityState] = useState({
    duplicates: 4,
    missingCovers: 3,
    uncategorized: 7,
    status: 'Needs Polish' as 'Needs Polish' | 'Healed',
    isHealing: false,
    score: 68,
  });

  // Loop scanner scanner line effect
  useEffect(() => {
    const timer = setInterval(() => {
      setLasersOn(prev => !prev);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const handleSimulateScan = () => {
    if (isScanning) return;
    setIsScanning(true);
    setTimeout(() => {
      const candidates = [
        {
          isbn: '9780441172719',
          title: 'Dune',
          author: 'Frank Herbert',
          status: 'verified',
          cover: '🏜️',
        },
        {
          isbn: '9780140449136',
          title: 'The Republic',
          author: 'Plato',
          status: 'verified',
          cover: '🏛️',
        },
        {
          isbn: '9780451526342',
          title: '1984',
          author: 'George Orwell',
          status: 'verified',
          cover: '👁️',
        },
      ];
      const randomBook =
        candidates[Math.floor(Math.random() * candidates.length)];

      // Prevent duplicates in queue
      if (!scannerQueue.some(item => item.isbn === randomBook.isbn)) {
        setScannerQueue(prev => [randomBook, ...prev]);
      }
      setIsScanning(false);
    }, 1200);
  };

  const handleSimulateHeal = () => {
    if (integrityState.isHealing || integrityState.status === 'Healed') return;
    setIntegrityState(prev => ({...prev, isHealing: true}));
    setTimeout(() => {
      setIntegrityState({
        duplicates: 0,
        missingCovers: 0,
        uncategorized: 0,
        status: 'Healed',
        isHealing: false,
        score: 100,
      });
    }, 1800);
  };

  const handleResetIntegrity = () => {
    setIntegrityState({
      duplicates: 4,
      missingCovers: 3,
      uncategorized: 7,
      status: 'Needs Polish',
      isHealing: false,
      score: 68,
    });
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-on-background">
        <BookLoader
          size="lg"
          className="mb-4 animate-in fade-in zoom-in-95 duration-500"
        />
        <span className="font-sans text-xs font-bold tracking-[0.2em] text-on-surface-variant uppercase animate-pulse">
          Consulting Archives...
        </span>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="bg-background text-on-background antialiased selection:bg-primary-container selection:text-on-primary-container min-h-screen flex flex-col">
      {/* Top Banner Navigation */}
      <nav className="bg-surface/80 backdrop-blur-md text-on-surface w-full top-0 sticky border-b border-outline-variant/30 z-50 flex justify-between items-center px-6 py-4">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-secondary" />
          <span className="font-serif text-2xl font-bold tracking-tight text-primary">
            book(ish)
          </span>
          <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-widest text-secondary bg-secondary-container/10 px-2 py-0.5 rounded border border-secondary/20">
            System 2.0
          </span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          <a
            href="#"
            className="font-sans text-xs uppercase tracking-wider font-bold text-primary border-b-2 border-secondary pb-0.5"
          >
            Overview
          </a>
          <a
            href="#simulator"
            className="font-sans text-xs uppercase tracking-wider font-bold text-on-surface-variant hover:text-primary transition-colors"
          >
            Interactive Tour
          </a>
          <a
            href="#features"
            className="font-sans text-xs uppercase tracking-wider font-bold text-on-surface-variant hover:text-primary transition-colors"
          >
            Mechanics
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={signIn}
            variant="outline"
            className="hidden sm:flex border-outline-variant hover:bg-surface-container font-sans text-xs font-bold uppercase tracking-wider"
          >
            Sign-In
          </Button>
          <Button
            onClick={signIn}
            className="bg-primary hover:bg-primary-container text-white font-sans text-xs font-bold uppercase tracking-wider px-4"
          >
            Get Started
          </Button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col items-center w-full">
        {/* HERO SECTION */}
        <section className="w-full max-w-[1200px] px-6 sm:px-12 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 flex flex-col items-start gap-6 text-left">
            <div className="inline-flex items-center gap-2 bg-secondary/10 border border-secondary/20 px-3 py-1 rounded-sm">
              <span className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse" />
              <span className="font-sans text-[10px] font-bold tracking-widest text-[#7d5633] uppercase">
                The Tactile Modern Archivist
              </span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-5xl font-bold text-primary leading-[1.1] tracking-tight max-w-xl">
              Curate your physical library with{' '}
              <span className="italic font-serif font-semibold text-secondary">
                celestial clarity
              </span>
              .
            </h1>

            <p className="font-sans text-body-md text-on-surface-variant/90 max-w-lg leading-relaxed">
              book(ish) is a tailored digital ledger for physical bookkeepers,
              built around quiet scholarly concentration. Automatically scan
              barcodes, generate relational constellation maps, utilize semantic
              AI daily curation, and verify library metadata depth.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto mt-4">
              <Button
                onClick={signIn}
                className="bg-primary hover:bg-primary-container text-white h-12 px-8 rounded font-sans font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm"
              >
                <svg
                  className="w-4 h-4 bg-white rounded-full p-0.5"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  ></path>
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  ></path>
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  ></path>
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  ></path>
                </svg>
                Sign In with Google
              </Button>
              <a
                href="#simulator"
                className="border border-outline border-secondary/30 text-secondary hover:bg-secondary/5 h-12 px-8 rounded font-sans font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
              >
                Live Interactive Tour
              </a>
            </div>

            <div className="flex items-center gap-6 mt-6 border-t border-outline-variant/30 pt-6 w-full max-w-lg">
              <div>
                <span className="block font-serif text-2xl font-bold text-primary">
                  100%
                </span>
                <span className="block font-sans text-[10px] text-on-surface-variant font-bold tracking-wider uppercase">
                  Private Archiving
                </span>
              </div>
              <div className="w-[1px] h-8 bg-outline-variant/40" />
              <div>
                <span className="block font-serif text-2xl font-bold text-primary">
                  3D
                </span>
                <span className="block font-sans text-[10px] text-on-surface-variant font-bold tracking-wider uppercase">
                  Thematic Constellation Map
                </span>
              </div>
              <div className="w-[1px] h-8 bg-outline-variant/40" />
              <div>
                <span className="block font-serif text-2xl font-bold text-primary">
                  Gemini-Pro
                </span>
                <span className="block font-sans text-[10px] text-on-surface-variant font-bold tracking-wider uppercase">
                  AI Daily Curator
                </span>
              </div>
            </div>
          </div>

          {/* Hero Visual Mockup */}
          <div className="lg:col-span-6 relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-outline-variant/40 shadow-[0_12px_40px_rgba(26,47,75,0.06)] bg-[#021a35]">
            <div className="absolute inset-0 bg-gradient-to-t from-[#021a35]/80 via-transparent to-[#021a35]/40" />
            <div className="absolute inset-0 flex flex-col justify-between p-8 z-10 text-white">
              {/* Mock Header overlay */}
              <div className="flex justify-between items-center w-full">
                <div className="flex gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-400/80" />
                  <span className="w-3 h-3 rounded-full bg-amber-400/80" />
                  <span className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <span className="font-sans text-[10px] font-bold tracking-wider uppercase text-white/50">
                  book(ish) Core HUD
                </span>
              </div>

              {/* Constellation Canvas Representation */}
              <div className="flex-grow flex items-center justify-center relative w-full my-6">
                {/* SVG glowing orbital paths */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                  <line
                    x1="25%"
                    y1="30%"
                    x2="45%"
                    y2="75%"
                    stroke="white"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  <line
                    x1="45%"
                    y1="75%"
                    x2="75%"
                    y2="25%"
                    stroke="white"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  <line
                    x1="25%"
                    y1="30%"
                    x2="75%"
                    y2="25%"
                    stroke="white"
                    strokeWidth="0.5"
                  />
                  <line
                    x1="20%"
                    y1="80%"
                    x2="45%"
                    y2="75%"
                    stroke="white"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  <line
                    x1="75%"
                    y1="25%"
                    x2="80%"
                    y2="70%"
                    stroke="white"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  <line
                    x1="45%"
                    y1="75%"
                    x2="80%"
                    y2="70%"
                    stroke="white"
                    strokeWidth="0.5"
                  />
                </svg>

                {/* Simulated Core Star nodes */}
                <div className="absolute left-[25%] top-[30%] group">
                  <div className="w-3 h-3 bg-white rounded-full animate-ping absolute -inset-1 opacity-40" />
                  <div className="w-3 h-3 bg-[#e5bc92] rounded-full cursor-pointer relative" />
                  <span className="absolute left-4 -top-2 scale-90 whitespace-nowrap bg-[#1a2f4b]/90 text-[10px] text-white py-0.5 px-2 rounded border border-white/10 opacity-70">
                    Donna Tartt
                  </span>
                </div>

                <div className="absolute left-[45%] top-[75%]">
                  <div className="w-4 h-4 bg-white rounded-full animate-ping absolute -inset-1.5 opacity-30" />
                  <div className="w-4 h-4 bg-white rounded-full cursor-pointer relative" />
                  <span className="absolute left-5 -top-2 scale-95 whitespace-nowrap bg-[#1a2f4b]/90 text-[11px] font-bold text-[#e5bc92] py-0.5 px-2 rounded border border-white/10 shadow-lg">
                    The Sacred Solitude Grid
                  </span>
                </div>

                <div className="absolute left-[75%] top-[25%]">
                  <div className="w-2.5 h-2.5 bg-[#adcebd] rounded-full cursor-pointer" />
                  <span className="absolute left-4 -top-2 scale-90 whitespace-nowrap bg-[#1a2f4b]/90 text-[10px] text-white py-0.5 px-2 rounded border border-white/10 opacity-70">
                    Frank Herbert
                  </span>
                </div>

                <div className="absolute left-[20%] top-[80%]">
                  <div className="w-2.5 h-2.5 bg-red-400 rounded-full cursor-pointer opacity-80" />
                </div>

                <div className="absolute left-[80%] top-[70%]">
                  <div className="w-3 h-3 bg-[#f0bc92] rounded-full cursor-pointer opacity-90" />
                </div>
              </div>

              {/* Float box displaying active curation overlay */}
              <div className="bg-[#1a2f4b]/95 border border-white/10 text-white/90 p-4 rounded shadow-lg max-w-[280px] self-end text-left sm:translate-y-4">
                <div className="flex gap-2.5 items-start">
                  <div className="w-8 h-12 bg-white/10 rounded-sm flex items-center justify-center text-lg shadow-inner">
                    🌌
                  </div>
                  <div>
                    <h4 className="font-serif text-[11px] text-[#e5bc92] uppercase font-bold tracking-widest leading-none mb-1">
                      Celestial Vaults Map
                    </h4>
                    <span className="block font-serif text-sm font-bold text-white mb-0.5 line-clamp-1">
                      Classic Philosophy Cluster
                    </span>
                    <span className="block font-sans text-[9px] text-white/50">
                      3 Connected Books · Stoicism node active
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE TOUR / SIMULATOR SHOWCASE */}
        <section
          id="simulator"
          className="w-full bg-surface-container-low py-16 border-t border-outline-variant/30 scroll-mt-16"
        >
          <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <span className="font-sans text-[10px] font-bold tracking-widest text-[#7d5633] uppercase">
                Interactive Previews
              </span>
              <h2 className="font-serif text-3xl font-bold text-primary mt-2 mb-4">
                Test the systems before you join
              </h2>
              <p className="font-sans text-body-md text-on-surface-variant">
                Interact with the miniature sandboxed components below to see
                exactly how book(ish) parses, curates, and optimizes library
                states.
              </p>
            </div>

            {/* TAB CONTAINER */}
            <div className="bg-surface border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm flex flex-col">
              {/* Selector Tabs */}
              <div className="border-b border-outline-variant/30 bg-surface-container flex flex-wrap md:flex-row gap-0">
                <button
                  onClick={() => setActiveDemoTab('constellation')}
                  className={`flex-1 min-w-[150px] py-4 px-6 text-center font-sans text-xs uppercase tracking-wider font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeDemoTab === 'constellation'
                      ? 'border-secondary text-secondary bg-surface'
                      : 'border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container-high/40'
                  }`}
                >
                  <Compass className="w-4 h-4" />
                  3D Theme Map
                </button>
                <button
                  onClick={() => setActiveDemoTab('scanner')}
                  className={`flex-1 min-w-[150px] py-4 px-6 text-center font-sans text-xs uppercase tracking-wider font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeDemoTab === 'scanner'
                      ? 'border-secondary text-secondary bg-surface'
                      : 'border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container-high/40'
                  }`}
                >
                  <ScanBarcode className="w-4 h-4" />
                  Instant ISBN Feed
                </button>
                <button
                  onClick={() => setActiveDemoTab('curator')}
                  className={`flex-1 min-w-[150px] py-4 px-6 text-center font-sans text-xs uppercase tracking-wider font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeDemoTab === 'curator'
                      ? 'border-secondary text-secondary bg-surface'
                      : 'border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container-high/40'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Gemini Daily AI Pick
                </button>
                <button
                  onClick={() => setActiveDemoTab('integrity')}
                  className={`flex-1 min-w-[150px] py-4 px-6 text-center font-sans text-xs uppercase tracking-wider font-bold border-b-2 transition-all flex items-center justify-center gap-2 ${
                    activeDemoTab === 'integrity'
                      ? 'border-secondary text-secondary bg-surface'
                      : 'border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container-high/40'
                  }`}
                >
                  <Database className="w-4 h-4" />
                  Parchment Audit Check
                </button>
              </div>

              {/* DEMO WRAPPER DISPLAY */}
              <div className="p-6 sm:p-8 bg-surface text-left min-h-[440px] flex flex-col justify-between">
                <AnimatePresence mode="wait">
                  {activeDemoTab === 'constellation' && (
                    <motion.div
                      key="constellation"
                      initial={{opacity: 0, y: 10}}
                      animate={{opacity: 1, y: 0}}
                      exit={{opacity: 0, y: -10}}
                      transition={{duration: 0.3}}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full h-full"
                    >
                      {/* Left Map */}
                      <div className="lg:col-span-8 bg-[#021a35] rounded-lg border border-outline-variant/20 p-6 relative h-[380px] overflow-hidden flex flex-col justify-between">
                        <div className="absolute inset-0 bg-radial-gradient from-white/5 to-transparent pointer-events-none" />

                        <div className="flex justify-between items-center relative z-10">
                          <span className="font-sans text-[9px] uppercase font-bold tracking-widest text-[#e5bc92] bg-[#1a2f4b] py-1 px-2 border border-white/5 rounded">
                            Interactive Star Clusters
                          </span>
                          <span className="font-sans text-[10px] text-white/50">
                            Hover stars to isolate semantic nodes
                          </span>
                        </div>

                        {/* Interactive celestial nodes */}
                        <div className="relative w-full h-44 my-4 flex-grow">
                          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30">
                            <line
                              x1="25%"
                              y1="30%"
                              x2="45%"
                              y2="75%"
                              stroke="#ffdcc2"
                              strokeWidth="1"
                            />
                            <line
                              x1="45%"
                              y1="75%"
                              x2="75%"
                              y2="25%"
                              stroke="#ffdcc2"
                              strokeWidth="1"
                            />
                            <line
                              x1="25%"
                              y1="30%"
                              x2="75%"
                              y2="25%"
                              stroke="white"
                              strokeWidth="0.5"
                              strokeDasharray="2,2"
                            />
                            <line
                              x1="20%"
                              y1="80%"
                              x2="45%"
                              y2="75%"
                              stroke="white"
                              strokeWidth="0.5"
                              strokeDasharray="2,2"
                            />
                            <line
                              x1="75%"
                              y1="25%"
                              x2="80%"
                              y2="70%"
                              stroke="#ffdcc2"
                              strokeWidth="1"
                            />
                          </svg>

                          {CONSTELLATION_BOOKS.map(b => {
                            const isFocused = hoveredBook?.id === b.id;
                            return (
                              <div
                                key={b.id}
                                style={{left: `${b.x}%`, top: `${b.y}%`}}
                                className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer z-25 group"
                                onMouseEnter={() => setHoveredBook(b)}
                                onMouseLeave={() => setHoveredBook(null)}
                              >
                                {isFocused && (
                                  <span className="absolute -inset-2.5 bg-white/10 rounded-full animate-ping duration-1000" />
                                )}
                                <div
                                  className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-300 ${
                                    isFocused
                                      ? 'bg-[#ffffff] border-[#ffdcc2] scale-125 shadow-[0_0_12px_#ffffff]'
                                      : 'bg-primary-container border-white/40 group-hover:border-white'
                                  }`}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {/* Background starry night indicator info */}
                        <div className="relative z-10 flex flex-wrap gap-4 pt-4 border-t border-white/5">
                          {CONSTELLATION_BOOKS.map(b => (
                            <button
                              key={b.id}
                              onMouseEnter={() => setHoveredBook(b)}
                              className={`font-sans text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                hoveredBook?.id === b.id
                                  ? 'bg-[#ffdcc2] text-primary font-bold border-transparent'
                                  : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                              }`}
                            >
                              {b.title}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Right Readout Details */}
                      <div className="lg:col-span-4 flex flex-col justify-between bg-surface-container border border-outline-variant/30 rounded-lg p-5">
                        <div className="space-y-4">
                          <span className="font-sans text-[10px] font-bold tracking-widest text-on-surface-variant uppercase block">
                            Astronomy Panel
                          </span>
                          {hoveredBook ? (
                            <motion.div
                              initial={{opacity: 0, x: 5}}
                              animate={{opacity: 1, x: 0}}
                              className="space-y-3"
                            >
                              <div className="text-3xl text-secondary">🌌</div>
                              <div>
                                <h4 className="font-serif text-lg font-bold text-primary leading-tight">
                                  {hoveredBook.title}
                                </h4>
                                <span className="block font-sans text-xs text-on-surface-variant font-medium mt-0.5">
                                  by {hoveredBook.author}
                                </span>
                              </div>
                              <div className="space-y-1.5 pt-2 border-t border-outline-variant/40">
                                <div>
                                  <span className="block font-sans text-[9px] uppercase font-bold tracking-wider text-on-surface-variant">
                                    Thematic Star Cluster:
                                  </span>
                                  <span className="font-sans text-xs text-secondary font-semibold">
                                    {hoveredBook.genre}
                                  </span>
                                </div>
                                <p className="font-sans text-[11px] text-on-surface-variant/80 italic leading-snug pt-1">
                                  Tags like philosophy and Classics are mapped
                                  instantly into constellation trajectories
                                  forming real astronomical visual groupings.
                                </p>
                              </div>
                            </motion.div>
                          ) : (
                            <div className="text-center py-12 text-on-surface-variant/60">
                              <Compass className="w-10 h-10 mx-auto text-on-surface-variant/30 mb-3 animate-spin duration-10000" />
                              <p className="font-sans text-xs">
                                Hover or tap on any stellar node in the left map
                                to audit catalog orbits
                              </p>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-outline-variant/30 pt-4 mt-4">
                          <Button
                            onClick={signIn}
                            className="w-full bg-primary hover:bg-primary-container text-white font-sans text-xs uppercase tracking-wider font-bold py-2.5 flex items-center justify-center gap-2"
                          >
                            Explore Constellation View
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeDemoTab === 'scanner' && (
                    <motion.div
                      key="scanner"
                      initial={{opacity: 0, y: 10}}
                      animate={{opacity: 1, y: 0}}
                      exit={{opacity: 0, y: -10}}
                      transition={{duration: 0.3}}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full h-full"
                    >
                      {/* Left Camera Feed mockup */}
                      <div className="lg:col-span-6 bg-[#121210] rounded-lg border border-outline-variant/20 p-6 relative h-[380px] overflow-hidden flex flex-col justify-between items-center text-center">
                        {/* Camera viewport bounds */}
                        <div className="absolute inset-4 border border-white/10 rounded flex flex-col justify-between p-4 bg-radial-gradient">
                          <div className="flex justify-between items-center">
                            <span className="font-sans text-[9px] text-[#2ebd7d] font-bold tracking-widest uppercase flex items-center gap-1.5 animate-pulse">
                              <span className="w-1.5 h-1.5 bg-[#2ebd7d] rounded-full" />
                              Camera Active
                            </span>
                            <span className="font-sans text-[9px] text-white/40">
                              Focal Limit: 2.0
                            </span>
                          </div>

                          {/* Sweeping scan laser line effect */}
                          <div className="relative w-full h-1 text-center flex items-center justify-center z-10">
                            <div
                              className={`w-full h-[2px] bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] transition-all duration-1000 ${
                                lasersOn ? 'translate-y-12' : '-translate-y-12'
                              }`}
                            />
                          </div>

                          <div className="text-white/30 text-[10px] space-y-1 py-3 bg-black/40 backdrop-blur-sm border border-white/5 rounded max-w-xs mx-auto w-full mb-1">
                            <span className="block font-sans uppercase font-bold tracking-widest text-[#ffdcc2] text-[9px]">
                              Virtual Barcode Target
                            </span>
                            <span className="block font-mono text-white/50">
                              |||| | ||||| | ||| ||||
                            </span>
                          </div>
                        </div>

                        <div className="relative z-10 w-full mt-auto mb-4">
                          <Button
                            onClick={handleSimulateScan}
                            disabled={isScanning}
                            className="bg-[#2ebd7d] hover:bg-[#2ebd7d]/90 text-[#001f14] border-none font-sans text-xs uppercase tracking-wider font-bold h-10 w-48 mx-auto"
                          >
                            {isScanning
                              ? 'Retrieving metadata...'
                              : 'Simulate Scan'}
                          </Button>
                        </div>
                      </div>

                      {/* Right scanned books queue list */}
                      <div className="lg:col-span-6 flex flex-col justify-between bg-surface-container border border-outline-variant/30 rounded-lg p-5">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center pb-2 border-b border-outline-variant/30">
                            <h4 className="font-sans text-[10px] font-bold tracking-widest text-on-surface-variant uppercase">
                              Scanned Import Queue
                            </h4>
                            <span className="text-xs font-sans text-on-surface-variant font-medium">
                              {scannerQueue.length} items logged
                            </span>
                          </div>

                          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                            {scannerQueue.map((item, idx) => (
                              <motion.div
                                key={item.isbn}
                                initial={
                                  idx === 0 ? {opacity: 0, x: -10} : false
                                }
                                animate={{opacity: 1, x: 0}}
                                className="flex justify-between items-center p-3 bg-surface border border-outline-variant/20 rounded-md shadow-inner"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-xl">{item.cover}</span>
                                  <div>
                                    <span className="block font-serif text-sm font-bold text-primary line-clamp-1">
                                      {item.title}
                                    </span>
                                    <span className="block font-sans text-[10px] text-on-surface-variant/80 uppercase tracking-wide">
                                      {item.author}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="font-mono text-[9px] text-[#7d5633] tracking-tight">
                                    {item.isbn}
                                  </span>
                                  <span className="font-sans text-[8px] font-extrabold uppercase bg-green-500/10 text-emerald-800 px-1.5 py-0.5 rounded border border-green-500/20 mt-0.5">
                                    verified
                                  </span>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-4 border-t border-outline-variant/30 mt-4 flex items-center justify-between gap-4">
                          <span className="font-sans text-[10px] text-on-surface-variant/80 leading-normal max-w-[65%]">
                            Our ISBN core is federated with Google Books and
                            OpenLibrary API pools for pristine cover fetches.
                          </span>
                          <Button
                            onClick={signIn}
                            variant="outline"
                            className="font-sans text-xs uppercase tracking-wider font-bold h-9 border-outline-variant"
                          >
                            Open Ledger
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeDemoTab === 'curator' && (
                    <motion.div
                      key="curator"
                      initial={{opacity: 0, y: 10}}
                      animate={{opacity: 1, y: 0}}
                      exit={{opacity: 0, y: -10}}
                      transition={{duration: 0.3}}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full h-full"
                    >
                      {/* Left: AI Curator Narrative panel */}
                      <div className="lg:col-span-8 bg-[#faf7f0] border border-outline-variant/60 rounded-lg p-6 sm:p-8 shadow-inner font-serif text-primary flex flex-col justify-between h-[380px] overflow-y-auto relative border-l-4 border-l-secondary">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center pb-2 border-b border-secondary/20 font-sans">
                            <span className="text-[10px] uppercase font-bold tracking-widest text-[#7d5633]">
                              Gemini Daily Digest Curation
                            </span>
                            <span className="text-[9px] text-[#7d5633]">
                              VOLUME IX · MAY 2026
                            </span>
                          </div>

                          <div className="space-y-3">
                            <h3 className="text-2xl font-bold font-serif text-[#021a35] italic leading-tight">
                              "The Architecture of Scholarly Solitude"
                            </h3>

                            <p className="font-serif text-sm text-[#021a35]/90 leading-relaxed text-justify first-letter:text-4xl first-letter:float-left first-letter:mr-2 first-letter:font-bold first-letter:text-[#7d5633]">
                              The titles we preserve in secret cabinets are
                              diaries of isolation. In examining Plato's
                              political system against Aurelius' quiet
                              meditations, we observe a mutual desire to
                              establish walls against chaos. While Plato
                              structures a rigid republic, Aurelius builds a
                              quiet kingdom solely within his private
                              notebook...
                            </p>

                            <p className="font-serif text-xs italic text-on-surface-variant/80 leading-relaxed pt-2 border-t border-secondary/10">
                              "True sanctuary is found entirely within the
                              library—where centuries of voices speak in
                              complete, orderly stillness."
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 font-sans mt-6 pt-4 border-t border-secondary/20">
                          <span className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-xs text-secondary font-bold">
                            A
                          </span>
                          <div>
                            <span className="block text-xs font-bold text-primary">
                              book(ish) AI Curator
                            </span>
                            <span className="block text-[9px] text-on-surface-variant">
                              Parsed from actual books: <u>Meditations</u> &{' '}
                              <u>The Republic</u>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Display the books highlighted */}
                      <div className="lg:col-span-4 flex flex-col justify-between bg-surface-container border border-outline-variant/30 rounded-lg p-5">
                        <div className="space-y-4">
                          <span className="font-sans text-[10px] font-bold tracking-widest text-on-surface-variant uppercase block">
                            Curated Books Shelf
                          </span>

                          <div className="space-y-3">
                            <div className="flex items-center gap-4 p-2 bg-surface/50 border border-outline-variant/20 rounded">
                              <span className="text-2xl">🏛️</span>
                              <div>
                                <h5 className="font-serif text-sm font-bold text-[#021a35]">
                                  The Republic
                                </h5>
                                <span className="block font-sans text-[10px] text-on-surface-variant">
                                  Plato · Classical Philosophy
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 p-2 bg-surface/50 border border-outline-variant/20 rounded">
                              <span className="text-2xl">✒️</span>
                              <div>
                                <h5 className="font-serif text-sm font-bold text-[#021a35]">
                                  Meditations
                                </h5>
                                <span className="block font-sans text-[10px] text-on-surface-variant">
                                  Marcus Aurelius · Stoicism
                                </span>
                              </div>
                            </div>
                          </div>

                          <p className="font-sans text-[11px] text-on-surface-variant leading-relaxed pt-2">
                            The AI Curator parses semantic thematic overlaps
                            inside your library to recommend unexpected,
                            beautiful pairing narratives every morning.
                          </p>
                        </div>

                        <div className="pt-4 border-t border-outline-variant/30 mt-4">
                          <Button
                            onClick={signIn}
                            className="w-full bg-[#1a2f4b] hover:bg-[#1a2f4b]/95 text-[#e5bc92] border-none font-sans text-xs uppercase tracking-wider font-bold py-2.5 flex items-center justify-center gap-2"
                          >
                            Access Daily Curator
                            <Sparkles className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {activeDemoTab === 'integrity' && (
                    <motion.div
                      key="integrity"
                      initial={{opacity: 0, y: 10}}
                      animate={{opacity: 1, y: 0}}
                      exit={{opacity: 0, y: -10}}
                      transition={{duration: 0.3}}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full h-full"
                    >
                      {/* Left Integrity score & diagnostics lists */}
                      <div className="lg:col-span-7 bg-surface border border-outline-variant/30 rounded-lg p-6 flex flex-col justify-between h-[380px] overflow-hidden">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center border-b border-outline-variant/20 pb-3">
                            <div>
                              <span className="font-sans text-[10px] font-bold tracking-widest text-[#7d5633] uppercase block">
                                Spruce-Up Vault Integrity
                              </span>
                              <h4 className="font-serif text-xl font-bold text-primary mt-1">
                                Catalog Audit Scores
                              </h4>
                            </div>

                            <div className="flex items-center gap-2 bg-surface-container p-2 rounded border border-outline-variant/30">
                              <span className="font-serif text-3xl font-extrabold text-primary">
                                {integrityState.score}
                              </span>
                              <div className="text-[9px] font-sans text-on-surface-variant uppercase font-bold leading-none">
                                <span>Score</span>
                                <span className="block text-secondary">
                                  / 100
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant/25 rounded">
                              <div className="flex items-center gap-2.5">
                                <Database className="w-4 h-4 text-secondary" />
                                <span className="font-sans text-xs font-semibold text-primary">
                                  Duplicate Volume records
                                </span>
                              </div>
                              {integrityState.duplicates > 0 ? (
                                <span className="text-[10px] font-sans font-bold text-[#ba1a1a] bg-red-100 px-2 py-0.5 rounded border border-red-200">
                                  {integrityState.duplicates} Detected
                                </span>
                              ) : (
                                <span className="text-[10px] font-sans font-bold text-[#2ebd7d] bg-[#2ebd7d]/10 px-2 py-0.5 rounded border border-[#2ebd7d]/20 flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Resolved
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant/25 rounded">
                              <div className="flex items-center gap-2.5">
                                <Camera className="w-4 h-4 text-secondary" />
                                <span className="font-sans text-xs font-semibold text-primary">
                                  Missing Cover Artwork files
                                </span>
                              </div>
                              {integrityState.missingCovers > 0 ? (
                                <span className="text-[10px] font-sans font-bold text-yellow-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                                  {integrityState.missingCovers} Missing
                                </span>
                              ) : (
                                <span className="text-[10px] font-sans font-bold text-[#2ebd7d] bg-[#2ebd7d]/10 px-2 py-0.5 rounded border border-[#2ebd7d]/20 flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Healed
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between p-2.5 bg-surface-container-low border border-outline-variant/25 rounded">
                              <div className="flex items-center gap-2.5">
                                <AlertTriangle className="w-4 h-4 text-[#ba1a1a] opacity-80" />
                                <span className="font-sans text-xs font-semibold text-primary">
                                  Uncategorized / Loose categories
                                </span>
                              </div>
                              {integrityState.uncategorized > 0 ? (
                                <span className="text-[10px] font-sans font-bold text-yellow-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-200">
                                  {integrityState.uncategorized} Items
                                </span>
                              ) : (
                                <span className="text-[10px] font-sans font-bold text-[#2ebd7d] bg-[#2ebd7d]/10 px-2 py-0.5 rounded border border-[#2ebd7d]/20 flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Anchored
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-outline-variant/20">
                          {integrityState.status === 'Healed' ? (
                            <button
                              onClick={handleResetIntegrity}
                              className="text-on-surface-variant hover:text-primary transition-colors flex items-center gap-2 font-sans text-[11px] uppercase font-bold tracking-wider"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Re-poll
                              database
                            </button>
                          ) : (
                            <span className="font-sans text-[10px] text-on-surface-variant font-medium">
                              Press "Heal Database" to trigger simulated
                              duplicate merge rules in memory.
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Spruce Actions detail column */}
                      <div className="lg:col-span-5 flex flex-col justify-between bg-surface-container border border-outline-variant/30 rounded-lg p-5">
                        <div className="space-y-4">
                          <span className="font-sans text-[10px] font-bold tracking-widest text-on-surface-variant uppercase block">
                            Ledger Correction Engine
                          </span>
                          <h4 className="font-serif text-lg font-bold text-primary">
                            Need a clean index?
                          </h4>
                          <p className="font-sans text-xs text-on-surface-variant/90 leading-relaxed">
                            No library stays perfectly curated on its own.
                            book(ish) scans for ISBN duplicates across multiple
                            shelves, queries missing metadata, matches BISAC
                            taxonomy folders, and can generate clean catalog
                            ledger indices with one click.
                          </p>

                          {integrityState.status === 'Healed' && (
                            <div className="bg-[#ebd9bd]/25 border border-secondary/20 p-3 rounded text-secondary flex items-start gap-2">
                              <span className="text-base">✨</span>
                              <span className="text-[11px] font-sans leading-snug">
                                <strong>System Audit perfect:</strong> All dummy
                                duplicates merged on core ISBN matching rules.
                                Missing covers filled via Google open index
                                lists.
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t border-outline-variant/30 mt-4">
                          <Button
                            onClick={handleSimulateHeal}
                            disabled={
                              integrityState.isHealing ||
                              integrityState.status === 'Healed'
                            }
                            className={`w-full font-sans text-xs uppercase tracking-wider font-bold py-3 flex items-center justify-center gap-2 ${
                              integrityState.status === 'Healed'
                                ? 'bg-emerald-800 text-white hover:bg-emerald-800'
                                : 'bg-primary hover:bg-primary-container text-white'
                            }`}
                          >
                            {integrityState.isHealing ? (
                              <>
                                <span className="w-3.5 h-3.5 border-2 border-t-white border-white/30 rounded-full animate-spin" />
                                Indexing & Merging...
                              </>
                            ) : integrityState.status === 'Healed' ? (
                              <>
                                <Check className="w-4 h-4" />
                                Database Cleansed & Perfected
                              </>
                            ) : (
                              <>
                                Heal Ledger Records
                                <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </section>

        {/* CORE FEATURES SECTION - 3 COLUMNS */}
        <section
          id="features"
          className="w-full py-24 bg-surface max-w-[1200px] px-6 sm:px-12"
        >
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="font-sans text-[10px] font-bold tracking-widest text-[#7d5633] uppercase">
              The Architecture of book(ish)
            </span>
            <h2 className="font-serif text-3xl font-bold text-primary mt-2">
              Modern engineering, classic reverence
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Column 1: Constellations */}
            <div className="flex flex-col gap-4 text-left p-6 rounded-lg bg-surface-container-low border border-outline-variant/20 hover:border-outline-variant/55 transition-all">
              <div className="w-10 h-10 bg-secondary/10 text-secondary rounded flex items-center justify-center font-bold text-lg border border-secondary/20">
                🌌
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mt-2">
                Celestial Tag Maps
              </h3>
              <p className="font-sans text-xs text-on-surface-variant font-bold uppercase tracking-wider">
                Astronomical Visualization
              </p>
              <p className="font-sans text-body-md text-on-surface-variant/95 leading-relaxed">
                Render your entire library catalog as a custom astronomical
                constellation. Connect titles physically through dynamic tag
                lines, creating an eye-safe stargazing model of your
                intellectual interests.
              </p>
            </div>

            {/* Column 2: Curation */}
            <div className="flex flex-col gap-4 text-left p-6 rounded-lg bg-surface-container-low border border-outline-variant/20 hover:border-outline-variant/55 transition-all">
              <div className="w-10 h-10 bg-secondary/10 text-secondary rounded flex items-center justify-center font-bold text-lg border border-secondary/20">
                ✨
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mt-2">
                The daily AI Critic
              </h3>
              <p className="font-sans text-xs text-on-surface-variant font-bold uppercase tracking-wider">
                Autonomous Recommendations
              </p>
              <p className="font-sans text-body-md text-on-surface-variant/95 leading-relaxed">
                Rather than generic shopping recommendations, book(ish)
                leverages Gemini pro models to write deep morning essays
                comparing two volumes from your shelves, formulating daily
                scholarly prompts.
              </p>
            </div>

            {/* Column 3: Integrity */}
            <div className="flex flex-col gap-4 text-left p-6 rounded-lg bg-surface-container-low border border-outline-variant/20 hover:border-outline-variant/55 transition-all">
              <div className="w-10 h-10 bg-secondary/10 text-secondary rounded flex items-center justify-center font-bold text-lg border border-secondary/20">
                🧬
              </div>
              <h3 className="font-serif text-xl font-bold text-primary mt-2">
                Parchment Score Audit
              </h3>
              <p className="font-sans text-xs text-on-surface-variant font-bold uppercase tracking-wider">
                Database optimization
              </p>
              <p className="font-sans text-body-md text-on-surface-variant/95 leading-relaxed">
                Run automated metadata cleaning sweeps. Find ISBN duplicate
                collisions, isolate books missing cover artwork, download
                dynamic printed PDF barcode sheets, or import entire lists
                smoothly using CSV formatting.
              </p>
            </div>
          </div>
        </section>

        {/* BOTTOM CALL TO ACTION */}
        <section className="w-full bg-[#021a35] py-20 border-t border-secondary-container/10 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#001f14]/40 to-transparent pointer-events-none" />
          <div className="max-w-[800px] mx-auto px-6 text-center relative z-10 space-y-6">
            <span className="font-sans text-[10px] font-bold tracking-widest text-[#fcc79c] uppercase bg-white/5 py-1 px-3.5 border border-white/10 rounded">
              Curate Your Sanctuary
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white max-w-xl mx-auto leading-tight">
              Curate, review, and preserve your books in a dedicated
              intellectual sanctuary
            </h2>
            <p className="font-sans text-body-md text-white/70 max-w-md mx-auto leading-relaxed">
              Log in securely with Google to immediately create unique shared or
              private shelves, audit records, and gaze at your constellation.
            </p>
            <div className="pt-4">
              <Button
                onClick={signIn}
                className="bg-[#fcc79c] hover:bg-[#fcc79c]/90 text-[#3a1d00] font-sans text-xs uppercase tracking-wider font-extrabold h-12 px-8 rounded shadow-md mx-auto flex items-center gap-2"
              >
                Sign In & Scan Your First Book
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-surface py-8 border-t border-outline-variant/30">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-12 flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-secondary" />
            <span className="font-serif text-lg font-bold text-primary">
              book(ish)
            </span>
            <span className="text-[9px] text-on-surface-variant/60 ml-2">
              © 2026 book(ish) Labs. All rights preserved.
            </span>
          </div>
          <div className="flex gap-6">
            <a
              href="#"
              className="font-sans text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              Privacy Policy
            </a>
            <a
              href="#"
              className="font-sans text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              Terms of Service
            </a>
            <a
              href="#simulator"
              className="font-sans text-xs text-[#7d5633] font-bold hover:underline transition-colors"
            >
              Live Interactive Tour
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

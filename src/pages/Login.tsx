import { useAuth } from '../contexts/AuthContext';
import { Navigate, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { User, Book, CheckCircle, ScanBarcode, Camera, ArrowRight, Library, BarChart } from 'lucide-react';

export default function Login() {
  const { user, isAuthReady, signIn } = useAuth();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-on-background">Loading...</div>;
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <div className="bg-background text-on-background antialiased selection:bg-primary-container selection:text-on-primary-container min-h-screen flex flex-col">
      {/* TopNavBar */}
      <nav className="bg-surface text-on-surface w-full top-0 sticky border-b border-surface-variant shadow-sm shadow-slate-900/5 z-50 flex justify-between items-center px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-headline-md text-headline-md italic font-semibold text-primary">Athenaeum</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <a className="font-body-md text-body-md text-primary font-bold border-b-2 border-primary hover:bg-surface-container transition-colors px-2 py-1" href="#">Home</a>
          <a className="font-body-md text-body-md text-on-surface-variant hover:bg-surface-container transition-colors px-2 py-1" href="#features">Features</a>
          <a className="font-body-md text-body-md text-on-surface-variant hover:bg-surface-container transition-colors px-2 py-1" href="#about">About</a>
        </div>
        <div className="flex items-center gap-4">
          <button aria-label="Account" onClick={signIn} className="hover:bg-surface-container transition-colors p-2 rounded-full flex items-center justify-center group">
            <User className="w-6 h-6 text-primary group-hover:opacity-80 transition-opacity" />
          </button>
        </div>
      </nav>

      <main className="flex-grow flex flex-col items-center w-full">
        {/* Hero Section */}
        <section className="w-full max-w-[1200px] px-6 md:px-12 py-16 md:py-24 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="md:col-span-6 flex flex-col items-start gap-6"
          >
            <span className="font-label-caps text-label-caps text-secondary uppercase tracking-widest bg-secondary-container/20 px-3 py-1 rounded-sm">Your Personal Librarian</span>
            <h1 className="font-headline-xl text-headline-xl text-primary max-w-lg leading-tight">Curate your legacy, one page at a time.</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-md leading-relaxed">
                Athenaeum is the digital sanctuary for your physical books. Effortlessly catalog your collection, discover reading insights, and maintain the elegance of a private estate library in your pocket.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button 
                onClick={signIn}
                className="bg-primary text-on-primary font-body-md text-body-md px-6 py-3 rounded flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors architectural-shadow group border border-transparent"
              >
                <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path></svg>
                Sign in with Google
              </button>
              <a href="#features" className="bg-transparent border border-primary text-primary font-body-md text-body-md px-6 py-3 rounded flex items-center justify-center gap-2 hover:bg-surface-variant/50 transition-colors">
                Explore Features
              </a>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="md:col-span-6 relative h-[500px] w-full rounded-xl overflow-hidden architectural-shadow border border-surface-variant/50 bg-surface-container"
          >
            <img 
              alt="A beautifully organized home library with wooden shelves, soft warm lighting, and a cozy reading chair in a modern aesthetic" 
              className="w-full h-full object-cover opacity-90 mix-blend-multiply" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuANTu8B04Yd9MOa0lR2OzXNzYxQ4VVm53V3HKgmxH65JXfNqcGbfhGKaCbAIxnxuD7AsJcN9dopbwz-FCIgU6JMfBaDaspfcJE0v4A7_6Sq7nu_Nuv8QmjQ1jKhM8nqWBq1eMyw1NjX_GFyeMs-eJPlH2fJmIM8IJwPrFeoOsBc8OW1yCVqg2b3rDCMpcc77pn6E1ACE4hec9wA3emjWOr97hlC4daqn4MZzpWVtRAVa92uyxzh5nop_UubG_T43dGEy0SLBOOiDSsS"
            />
            {/* Floating Glass Card */}
            <div className="absolute bottom-8 right-8 bg-surface/85 backdrop-blur-md p-6 rounded-lg shadow-lg border border-surface-variant max-w-[280px]">
              <div className="flex items-start gap-4">
                <div className="w-12 h-16 bg-surface-variant rounded flex-shrink-0 flex items-center justify-center">
                  <Book className="w-6 h-6 text-on-surface-variant" />
                </div>
                <div>
                  <p className="font-headline-md text-headline-md text-primary leading-none mb-1">The Secret History</p>
                  <p className="font-body-md text-body-md text-on-surface-variant text-sm">Donna Tartt</p>
                  <div className="mt-2 inline-flex items-center gap-1 bg-tertiary-container/10 text-on-tertiary-container font-label-caps text-label-caps px-2 py-0.5 rounded-sm">
                    <CheckCircle className="w-3.5 h-3.5" /> Added to Shelf
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Features Bento Grid */}
        <section id="features" className="w-full bg-surface-container-low py-24 border-t border-surface-variant border-b">
          <div className="max-w-[1200px] mx-auto px-6 md:px-12 flex flex-col items-center">
            <div className="text-center max-w-2xl mb-16">
              <h2 className="font-headline-lg text-headline-lg text-primary mb-4">Cultivate your collection effortlessly</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">Intelligent tools designed for the modern archivist, ensuring your library is as organized digitally as it is physically.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 w-full auto-rows-[300px]">
              {/* Feature 1: ISBN Scanning (Large) */}
              <div className="md:col-span-8 bg-surface rounded-xl p-8 architectural-shadow border border-surface-variant flex flex-col sm:flex-row items-center gap-8 overflow-hidden relative">
                <div className="flex-1 flex flex-col items-start z-10">
                  <div className="w-12 h-12 bg-primary-container text-on-primary-container rounded-full flex items-center justify-center mb-4">
                    <ScanBarcode className="w-6 h-6" />
                  </div>
                  <h3 className="font-headline-md text-headline-md text-primary mb-2">Instant ISBN Scanning</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">Add volumes to your catalog instantly. A single scan retrieves high-resolution covers, publication details, and full metadata.</p>
                </div>
                <div className="flex-1 h-full w-full relative min-h-[200px]">
                  {/* Abstract UI Representation */}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[240px] h-[320px] bg-surface-container rounded-lg border border-surface-variant p-4 shadow-xl rotate-[-5deg] flex flex-col gap-3">
                    <div className="w-full h-40 bg-surface-variant rounded flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-primary/5 border-2 border-primary/20 flex items-center justify-center">
                        <div className="w-full h-0.5 bg-error/50 absolute top-1/2 shadow-[0_0_8px_rgba(186,26,26,0.8)]"></div>
                      </div>
                    </div>
                    <div className="h-4 w-3/4 bg-surface-dim rounded"></div>
                    <div className="h-3 w-1/2 bg-surface-dim rounded"></div>
                    <div className="h-8 w-full bg-primary/10 rounded mt-auto"></div>
                  </div>
                </div>
              </div>

              {/* Feature 2: Shelf Vision (Small) */}
              <div className="md:col-span-4 bg-surface rounded-xl p-8 architectural-shadow border border-surface-variant flex flex-col items-start relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 to-transparent z-0"></div>
                <div className="w-12 h-12 bg-secondary-container text-on-secondary-container rounded-full flex items-center justify-center mb-4 z-10">
                  <Camera className="w-6 h-6" />
                </div>
                <h3 className="font-headline-md text-headline-md text-primary mb-2 z-10">Shelf Vision AI</h3>
                <p className="font-body-md text-body-md text-on-surface-variant z-10 mb-6">Photograph an entire shelf. Our AI extracts titles and authors, importing dozens of books in seconds.</p>
                <div className="mt-auto w-full flex justify-end z-10">
                  <button onClick={signIn} className="w-10 h-10 rounded-full border border-secondary flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-on-secondary transition-colors">
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Feature 3: Elegant Organization (Small) */}
              <div className="md:col-span-5 bg-surface rounded-xl p-8 architectural-shadow border border-surface-variant flex flex-col items-start relative">
                <div className="w-12 h-12 bg-tertiary-container text-on-tertiary-container rounded-full flex items-center justify-center mb-4">
                  <Library className="w-6 h-6" />
                </div>
                <h3 className="font-headline-md text-headline-md text-primary mb-2">Tactile Organization</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">Sort by genre, reading status, or custom collections. A minimalist interface inspired by ledger lines and fine stationery.</p>
                {/* Mini Ledger View */}
                <div className="w-full mt-6 flex flex-col gap-2">
                  <div className="flex items-center justify-between border-b border-surface-variant pb-2">
                    <span className="font-body-md text-body-md text-primary text-sm">Fiction</span>
                    <span className="font-body-md text-body-md text-on-surface-variant text-xs">142 vols</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-surface-variant pb-2">
                    <span className="font-body-md text-body-md text-primary text-sm">Philosophy</span>
                    <span className="font-body-md text-body-md text-on-surface-variant text-xs">38 vols</span>
                  </div>
                </div>
              </div>

              {/* Feature 4: Reading Stats (Large) */}
              <div className="md:col-span-7 bg-primary text-on-primary rounded-xl p-8 architectural-shadow border border-primary-container flex flex-col sm:flex-row items-center gap-8 overflow-hidden relative">
                {/* Abstract Background element */}
                <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-primary-container rounded-full blur-3xl opacity-50"></div>
                <div className="flex-1 flex flex-col items-start z-10">
                  <div className="w-12 h-12 bg-primary-fixed text-on-primary-fixed rounded-full flex items-center justify-center mb-4">
                    <BarChart className="w-6 h-6" />
                  </div>
                  <h3 className="font-headline-md text-headline-md text-surface-container-lowest mb-2">Quiet Insights</h3>
                  <p className="font-body-md text-body-md text-primary-fixed-dim">Track your reading habits without the noise of social networks. View pages read, genres explored, and reading streaks in elegant, subdued charts.</p>
                </div>
                <div className="flex-1 w-full h-full min-h-[150px] flex items-end justify-center gap-3 z-10 pb-4">
                  {/* Simple bar chart representation */}
                  <div className="w-8 h-[40%] bg-primary-fixed/40 rounded-t-sm"></div>
                  <div className="w-8 h-[60%] bg-primary-fixed/60 rounded-t-sm"></div>
                  <div className="w-8 h-[30%] bg-primary-fixed/30 rounded-t-sm"></div>
                  <div className="w-8 h-[80%] bg-primary-fixed rounded-t-sm"></div>
                  <div className="w-8 h-[50%] bg-primary-fixed/50 rounded-t-sm"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Simple Footer */}
      <footer id="about" className="bg-surface py-8 border-t border-surface-variant mt-auto">
        <div className="max-w-[1200px] mx-auto px-6 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-headline-md text-headline-md italic font-semibold text-primary">Athenaeum</span>
          <div className="flex gap-6">
            <a className="font-body-md text-body-md text-on-surface-variant text-sm hover:text-primary transition-colors" href="#">Privacy Policy</a>
            <a className="font-body-md text-body-md text-on-surface-variant text-sm hover:text-primary transition-colors" href="#">Terms of Service</a>
            <a className="font-body-md text-body-md text-on-surface-variant text-sm hover:text-primary transition-colors" href="#">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

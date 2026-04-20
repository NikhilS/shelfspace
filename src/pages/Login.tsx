import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {
  const { user, isAuthReady, signIn } = useAuth();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink">Loading...</div>;
  }

  if (user) {
    return <Navigate to="/" />;
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen flex flex-col items-center justify-center bg-paper p-4 font-sans relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-yellow-200/40 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />
      
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
        className="max-w-md w-full bg-surface/80 backdrop-blur-xl rounded-[32px] shadow-2xl shadow-ink/5 p-10 sm:p-12 text-center border border-border/40 relative z-10"
      >
        <div className="w-24 h-24 bg-accent text-surface rounded-full flex items-center justify-center mx-auto mb-8 shadow-xl shadow-accent/20 border-4 border-surface ring-1 ring-border/20">
          <BookOpen size={40} strokeWidth={2} />
        </div>
        <h1 className="text-4xl sm:text-5xl font-serif font-bold text-ink mb-4 tracking-tight">ShelfSpace</h1>
        <p className="text-muted mb-12 font-sans text-lg font-medium">Your personal book librarian and companion.</p>
        
        <button
          onClick={signIn}
          className="w-full flex items-center justify-center gap-3 bg-paper border border-border/60 text-ink font-sans font-bold py-4 px-4 rounded-full hover:bg-surface hover:border-border hover:shadow-md transition-all group"
        >
          <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
            <path d="M1 1h22v22H1z" fill="none" />
          </svg>
          Continue with Google
        </button>
      </motion.div>
    </motion.div>
  );
}

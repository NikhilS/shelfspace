import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, Bot, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';

interface ChatbotProps {
  libraryBooks: { title: string; author: string; genre?: string; description?: string }[];
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export default function Chatbot({ libraryBooks }: ChatbotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<any>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && !chatRef.current) {
      initChat();
    }
  }, [isOpen, libraryBooks]);

  const initChat = () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const limitedBooks = libraryBooks.slice(0, 50);
      const bookList = limitedBooks.map(b => `- "${b.title}" by ${b.author}${b.genre ? ` (${b.genre})` : ''}`).join('\n');
      
      const systemInstruction = `You are an expert, friendly AI librarian assisting a user with their personal book library. 
Here is the current list of books in their library:
${bookList || 'The library is currently empty.'}

Answer any questions they have about their books, suggest what to read next, find patterns in their reading habits, or recommend new books based on their collection.
Format your responses using Markdown. Be concise, helpful, and engaging.`;

      chatRef.current = ai.chats.create({
        model: 'gemini-3.1-pro-preview',
        config: {
          systemInstruction,
        }
      });

      setMessages([{
        id: 'welcome',
        role: 'model',
        text: "Hello! I'm your AI Librarian. Ask me anything about your collection or for recommendations on what to read next!"
      }]);
    } catch (error) {
      console.error("Failed to initialize chat:", error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !chatRef.current) return;

    const userText = input.trim();
    setInput('');
    
    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: userText
    };
    
    setMessages(prev => [...prev, newMessage]);
    setIsLoading(true);

    try {
      let responseText = '';
      const streamResponse = await chatRef.current.sendMessageStream({ message: userText });
      
      const modelMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: modelMessageId, role: 'model', text: '' }]);

      for await (const chunk of streamResponse) {
        responseText += chunk.text;
        setMessages(prev => prev.map(msg => 
          msg.id === modelMessageId ? { ...msg, text: responseText } : msg
        ));
      }
    } catch (error: unknown) {
      console.error("Error sending message:", error);
      const isQuota = typeof error === 'object' && error !== null && ('status' in error && (error as {status: number}).status === 429) || (error instanceof Error && (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota')));
      const errorMessage = isQuota
        ? "The AI Librarian is currently resting (quota limit). Please come back later!"
        : "I'm sorry, I encountered an error while trying to respond. Please try again.";
        
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'model', 
        text: errorMessage
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 p-4 bg-accent text-white rounded-full shadow-xl hover:bg-accent/90 hover:scale-105 transition-all z-40 flex items-center justify-center"
        aria-label="Open AI Librarian Chat"
      >
        <MessageSquare size={24} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] h-[36rem] max-h-[calc(100vh-8rem)] bg-surface/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-border/40 flex flex-col overflow-hidden z-[60] font-sans"
          >
            {/* Header */}
            <div className="bg-surface/50 px-5 py-4 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent text-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
                  <Bot size={20} strokeWidth={2} />
                </div>
                <div>
                  <h3 className="font-serif font-bold text-ink leading-tight tracking-tight">AI Librarian</h3>
                  <p className="text-xs text-muted font-medium">Powered by Gemini</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 text-muted hover:bg-surface rounded-full transition-colors border border-transparent hover:border-border/60"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-surface/30 custom-scrollbar">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === 'user' ? 'bg-ink text-paper' : 'bg-accent text-white'
                    }`}>
                      {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className="p-4 rounded-3xl bg-surface border border-border/40 text-ink rounded-tl-sm shadow-sm">
                      <div className="markdown-body text-sm max-w-none text-ink/90">
                        <Markdown>{msg.text}</Markdown>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex gap-2 max-w-[85%] flex-row">
                    <div className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0">
                      <Bot size={16} />
                    </div>
                    <div className="p-3 rounded-2xl bg-surface border border-border text-ink rounded-tl-sm flex items-center">
                      <Loader2 size={16} className="animate-spin text-accent" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-surface/50 border-t border-border/40 backdrop-blur-sm">
              <div className="relative flex items-center">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your library..."
                  className="w-full bg-paper/80 border border-border/60 rounded-2xl pl-5 pr-14 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink/40 resize-none font-medium custom-scrollbar"
                  rows={1}
                  style={{ minHeight: '50px', maxHeight: '120px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 p-2.5 text-surface bg-accent disabled:bg-surface disabled:text-muted hover:bg-accent/90 rounded-xl transition-all shadow-sm disabled:shadow-none"
                >
                  <Send size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

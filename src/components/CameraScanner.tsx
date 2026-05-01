import React, {useRef, useState, useEffect} from 'react';
import {Camera, UploadCloud, Loader2, Sparkles} from 'lucide-react';
import {extractBooksFromImage} from '../services/gemini';
import {toast} from 'sonner';

interface CameraScannerProps {
  onBooksExtracted: (
    books: {
      title: string;
      author: string;
      isbn?: string;
      genres?: string[];
      format?: 'physical' | 'digital';
    }[],
  ) => void;
  isExtracting: boolean;
  setIsExtracting: (extracting: boolean) => void;
}

export default function CameraScanner({
  onBooksExtracted,
  isExtracting,
  setIsExtracting,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamReqId = useRef<number | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const startCamera = async () => {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: 'environment'},
        });
      } catch (err) {
        const error = err as Error;
        if (
          error.name === 'OverconstrainedError' ||
          error.name === 'NotFoundError'
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;

      const attachStream = () => {
        if (!streamRef.current) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsCameraActive(true);
          };
        } else {
          streamReqId.current = window.setTimeout(attachStream, 50);
        }
      };
      attachStream();
    } catch (err) {
      const error = err as Error;
      console.error(error);
      if (error.name === 'NotAllowedError') {
        toast.error(
          'Camera access denied. Please click the padlock in your URL bar to allow camera access.',
        );
      } else {
        toast.error('Could not access camera');
      }
    }
  };

  const stopCamera = () => {
    if (streamReqId.current !== null) {
      clearTimeout(streamReqId.current);
      streamReqId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, []);

  const captureAndExtract = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      toast.error('Camera stream not ready yet.');
      return;
    }
    const MAX_DIMENSION = 1200;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height) {
      if (width > MAX_DIMENSION) {
        height *= MAX_DIMENSION / width;
        width = MAX_DIMENSION;
      }
    } else {
      if (height > MAX_DIMENSION) {
        width *= MAX_DIMENSION / height;
        height = MAX_DIMENSION;
      }
    }
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);

    // Allow UX to switch to extracting state immediately
    setIsExtracting(true);

    try {
      const books = await extractBooksFromImage(base64Image, 'image/jpeg');
      onBooksExtracted(books);
      if (books.length === 0) toast.error('No books found in image');
    } catch (error) {
      if (error instanceof Error) toast.error(error.message);
      else toast.error('Failed to extract books from image');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image file.');
      return;
    }
    setIsExtracting(true);
    stopCamera();
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result as string;
        try {
          const books = await extractBooksFromImage(base64Image, file.type);
          onBooksExtracted(books);
          if (books.length === 0) toast.error('No books found in image');
          else toast.success(`Found ${books.length} books.`);
        } catch (err) {
          if (err instanceof Error) toast.error(err.message);
          else toast.error('Failed to extract books from image');
        } finally {
          setIsExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error('Failed to process image file.');
      setIsExtracting(false);
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  if (isExtracting) {
    return (
      <div className="py-24 flex flex-col items-center justify-center w-full bg-surface-container-low/30 rounded-3xl border border-outline-variant/40">
        <div className="relative mb-6 text-primary">
          <Loader2
            className="animate-spin absolute inset-0"
            size={56}
            strokeWidth={1.5}
          />
          <Sparkles className="animate-pulse" size={56} strokeWidth={1.5} />
        </div>
        <h3 className="font-serif font-bold text-2xl text-on-surface tracking-tight mb-2">
          Analyzing bookshelf...
        </h3>
        <p className="text-on-surface-variant font-medium text-center max-w-xs">
          The AI Librarian is extracting book titles, authors, and metadata from
          your image.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md aspect-[3/4] bg-on-surface rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgb(26,47,75,0.12)] border border-outline-variant/30">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive ? (
        <div className="absolute bottom-4 sm:bottom-6 left-0 right-0 flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-3 px-4">
          <button
            onClick={captureAndExtract}
            data-testid="capture-shelf-action"
            className="bg-surface/95 backdrop-blur-md text-on-surface px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm border border-outline-variant/40 w-full sm:w-auto justify-center"
          >
            <Camera size={18} strokeWidth={2} /> Capture Shelf
          </button>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={imageInputRef}
            onChange={handleImageUpload}
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            className="bg-primary text-on-primary px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-primary/90 hover:scale-105 transition-all text-sm border border-transparent w-full sm:w-auto justify-center"
          >
            <UploadCloud size={18} strokeWidth={2} /> Upload Photo
          </button>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-surface/60 font-medium">
          <Camera size={48} strokeWidth={1.5} className="mb-4 opacity-40" />
          Camera inactive
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={imageInputRef}
            onChange={handleImageUpload}
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            className="mt-6 bg-surface text-on-surface px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm border border-outline-variant/40"
          >
            <UploadCloud size={18} strokeWidth={2} /> Upload Photo instead
          </button>
        </div>
      )}
    </div>
  );
}

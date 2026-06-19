import React, {useRef, useState, useEffect} from 'react';
import {Camera, UploadCloud, Loader2, Sparkles} from 'lucide-react';
import {toast} from 'sonner';
import {logger} from '../stores/debugStore';
import {Button} from '@/components/ui/button';
import {trpc} from '../lib/trpc';

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

  const extractBooksFromImageMutation =
    trpc.gemini.extractBooksFromImage.useMutation();

  const startCamera = async () => {
    logger.info('Starting camera access request...');
    try {
      let stream;
      try {
        logger.info('Requesting environment (back) camera...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: 'environment'},
        });
      } catch (err) {
        const error = err as Error;
        logger.warn(
          `Back camera failed: ${error.name}. Retrying with any camera...`,
        );
        if (
          error.name === 'OverconstrainedError' ||
          error.name === 'NotFoundError' ||
          error.name === 'NotReadableError' ||
          (error.message && error.message.includes('video source'))
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;
      logger.info('Camera stream acquired successfully.');

      const attachStream = () => {
        if (!streamRef.current) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            logger.info(
              `Video metadata loaded: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`,
            );
            setIsCameraActive(true);
          };
        } else {
          logger.info('Video element not ready, retrying attachment...');
          streamReqId.current = window.setTimeout(attachStream, 50);
        }
      };
      attachStream();
    } catch (err) {
      const error = err as Error;
      logger.error(`Camera start failed: ${error.name} - ${error.message}`);
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
    logger.info('Stopping camera...');
    if (streamReqId.current !== null) {
      clearTimeout(streamReqId.current);
      streamReqId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        logger.info(`Stopping track: ${track.label}`);
        track.stop();
      });
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
    logger.info(
      `Captured image: ${canvas.width}x${canvas.height}, approx ${Math.round(base64Image.length / 1024)} KB`,
    );

    // Allow UX to switch to extracting state immediately
    setIsExtracting(true);

    try {
      const books = await extractBooksFromImageMutation.mutateAsync({
        base64Image,
        mimeType: 'image/jpeg',
      });
      setIsExtracting(false);
      onBooksExtracted(books);
      if (books.length === 0) toast.error('No books found in image');
    } catch (error) {
      setIsExtracting(false);
      if (error instanceof Error) toast.error(error.message);
      else toast.error('Failed to extract books from image');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image file.');
      return;
    }
    logger.info(
      `Uploading image: ${file.name} (${Math.round(file.size / 1024)} KB, type: ${file.type})`,
    );
    setIsExtracting(true);
    stopCamera();
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result as string;
        try {
          const books = await extractBooksFromImageMutation.mutateAsync({
            base64Image,
            mimeType: file.type,
          });
          setIsExtracting(false);
          onBooksExtracted(books);
          if (books.length === 0) toast.error('No books found in image');
          else toast.success(`Found ${books.length} books.`);
        } catch (err) {
          setIsExtracting(false);
          if (err instanceof Error) toast.error(err.message);
          else toast.error('Failed to extract books from image');
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsExtracting(false);
      toast.error('Failed to process image file.');
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  if (isExtracting) {
    return (
      <div className="py-24 flex flex-col items-center justify-center w-full bg-surface-container-low/30 rounded-3xl border border-outline-variant/40">
        <div className="relative mb-6 text-primary w-20 h-20 flex items-center justify-center">
          <Loader2
            className="animate-spin absolute inset-0 w-full h-full text-primary/30"
            strokeWidth={1.5}
          />
          <Sparkles className="animate-pulse" size={40} strokeWidth={1.5} />
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
    <div className="w-full max-w-md aspect-[3/4] bg-on-surface rounded-3xl overflow-hidden relative shadow-elevation-3 border border-outline-variant/30">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive ? (
        <div className="absolute bottom-4 sm:bottom-6 left-0 right-0 flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-3 px-4">
          <Button
            variant="outline"
            onClick={captureAndExtract}
            data-testid="capture-shelf-action"
            className="bg-surface/95 backdrop-blur-md rounded-full font-bold shadow-elevation-2 flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all w-full sm:w-auto justify-center"
          >
            <Camera size={18} strokeWidth={2} /> Capture Shelf
          </Button>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={imageInputRef}
            onChange={handleImageUpload}
          />
          <Button
            onClick={() => imageInputRef.current?.click()}
            className="rounded-full font-bold shadow-elevation-2 flex items-center gap-2 hover:scale-105 transition-all w-full sm:w-auto justify-center"
          >
            <UploadCloud size={18} strokeWidth={2} /> Upload Photo
          </Button>
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
          <Button
            variant="outline"
            onClick={() => imageInputRef.current?.click()}
            className="mt-6 rounded-full font-bold shadow-lg flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all"
          >
            <UploadCloud size={18} strokeWidth={2} /> Upload Photo Instead
          </Button>
        </div>
      )}
    </div>
  );
}

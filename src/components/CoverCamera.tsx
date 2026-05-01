import React, {useRef, useState, useEffect} from 'react';
import {Camera, X} from 'lucide-react';
import {toast} from 'sonner';

interface CoverCameraProps {
  onCapture: (base64Image: string) => void;
  onCancel: () => void;
}

export default function CoverCamera({onCapture, onCancel}: CoverCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamReqId = useRef<number | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

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

  const captureCover = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      toast.error('Camera stream not ready yet.');
      return;
    }
    const MAX_DIMENSION = 800; // ensures the output base64 is safely under 1MB
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
    onCapture(base64Image);
  };

  return (
    <div className="w-full max-w-sm mx-auto aspect-[3/4] bg-on-surface rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgb(26,47,75,0.12)] border border-outline-variant/20 mb-4">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      {isCameraActive && (
        <button
          onClick={captureCover}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-md text-on-surface px-6 py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm whitespace-nowrap border border-outline-variant/40"
        >
          <Camera size={18} strokeWidth={2} /> Capture Cover
        </button>
      )}
      <button
        onClick={onCancel}
        className="absolute top-4 right-4 p-2 bg-on-surface text-surface rounded-full hover:bg-on-surface/90 transition-colors shadow-md border outline-none"
      >
        <X size={20} strokeWidth={2.5} />
      </button>
    </div>
  );
}

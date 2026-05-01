import React, {useState} from 'react';
import {useZxing} from 'react-zxing';

interface BarcodeScannerProps {
  onScan: (isbn: string) => void;
  paused?: boolean;
}

export default function BarcodeScanner({
  onScan,
  paused = false,
}: BarcodeScannerProps) {
  const [errorMsg, setErrorMsg] = useState<string>('');

  const {ref} = useZxing({
    onDecodeResult(result) {
      if (!paused) {
        onScan(result.getText());
      }
    },
    onError(error: unknown) {
      if (!errorMsg) {
        const msg =
          typeof error === 'string' ? error : (error as Error)?.message;
        if (
          msg.includes('video source') ||
          msg.includes('Permission') ||
          msg.includes('NotFound')
        ) {
          setErrorMsg(
            'Could not access camera. Please check permissions and ensure your device has a camera.',
          );
        }
      }
    },
    paused: paused || !!errorMsg,
  });

  return (
    <div className="w-full h-48 bg-black rounded-xl overflow-hidden relative border-2 border-primary/50 flex items-center justify-center">
      {errorMsg ? (
        <div className="p-4 text-center text-red-400 font-bold text-sm bg-surface/10 rounded-lg backdrop-blur-sm m-4 z-20 border border-red-500/30">
          {errorMsg}
        </div>
      ) : (
        <>
          <video ref={ref} className="w-full h-full object-cover" />
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-red-500 bg-opacity-70 shadow-[0_0_8px_rgba(239,68,68,0.8)] z-10 animate-pulse" />
          <div className="absolute top-0 bottom-0 left-12 right-12 border-x-2 border-white/20 z-10 pointer-events-none" />
        </>
      )}
    </div>
  );
}

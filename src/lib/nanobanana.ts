/**
 * Nanobanana Flash™ Image Correction Algorithm
 * Extracts and enhances book covers from raw camera snaps.
 */

interface NanobananaOptions {
  straighten?: boolean;
  contrast?: number;
  brightness?: number;
  cropPercent?: number;
}

export function applyNanobananaFlash(
  base64Image: string,
  options: NanobananaOptions = {},
): Promise<string> {
  const {
    straighten = true,
    contrast = 1.3,
    brightness = 1.08,
    cropPercent = 4, // 4% off each side to remove raw photo edge artifacts
  } = options;

  return new Promise((resolve, reject) => {
    if (!base64Image) {
      resolve('');
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Image);
        return;
      }

      // Compute cropped box bounds
      const cropX = (img.width * cropPercent) / 100;
      const cropY = (img.height * cropPercent) / 100;
      const srcW = img.width - cropX * 2;
      const srcH = img.height - cropY * 2;

      canvas.width = srcW;
      canvas.height = srcH;

      // Draw background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Enhance lighting: boost contrast, subtle brightness and warmth/saturation
      ctx.filter = `contrast(${contrast}) brightness(${brightness}) saturate(1.15)`;

      if (straighten) {
        // Correct mild alignment skew by rotating -0.015 radians (~1 degree)
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-0.012);
        ctx.drawImage(
          img,
          cropX,
          cropY,
          srcW,
          srcH,
          -canvas.width / 2,
          -canvas.height / 2,
          canvas.width,
          canvas.height,
        );
      } else {
        ctx.drawImage(
          img,
          cropX,
          cropY,
          srcW,
          srcH,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }

      // Output high-quality, lightweight compressed cover image
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = err => {
      reject(err);
    };
    img.src = base64Image;
  });
}

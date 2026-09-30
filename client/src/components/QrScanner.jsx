import { useEffect, useRef, useState } from 'react';

// Reads a UPI QR (upi://pay?pa=...&pn=...) from an image source. Returns { upiId, name } or null.
export function parseUpi(text) {
  if (!text?.toLowerCase().startsWith('upi://')) return null;
  const params = new URL(text.replace(/^upi:\/\//i, 'https://upi/')).searchParams;
  return params.get('pa') ? { upiId: params.get('pa'), name: params.get('pn') || '' } : null;
}

// Reads a UPI QR from a photo (File): returns { upiId, name } or null. The QR library is loaded only when needed.
export async function readUpiQrFile(file) {
  const [{ default: jsQR }, bitmap] = await Promise.all([import('jsqr'), createImageBitmap(file)]);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return parseUpi(jsQR(img.data, img.width, img.height)?.data);
}

// Live camera scanner: point the phone at the shop's UPI QR, it is read automatically and that frame
// is kept as the QR photo. onResult({ file, upiId, name }).
// Needs camera permission and a secure page (https or localhost).
export default function QrScanner({ onResult, onClose }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const [status, setStatus] = useState('Starting camera…');
  const [error, setError] = useState('');
  const done = useRef(onResult);
  done.current = onResult;

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Live scanning needs a secure (https) connection. Use the Camera or Gallery button instead.');
        return;
      }
      try {
        const [{ default: jsQR }, s] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
        ]);
        stream = s;
        if (stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus('Point the camera at the shop’s UPI QR code');

        const scan = () => {
          if (stopped) return;
          const v = video.current;
          if (v.videoWidth) {
            const c = canvas.current;
            const scale = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
            c.width = Math.round(v.videoWidth * scale);
            c.height = Math.round(v.videoHeight * scale);
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
            const upi = parseUpi(code?.data);
            if (upi) {
              stopped = true;
              c.toBlob((blob) => done.current({ file: new File([blob], 'shop-qr.jpg', { type: 'image/jpeg' }), ...upi }), 'image/jpeg', 0.9);
              return;
            }
            if (code?.data) setStatus('That QR is not a UPI payment QR — try the shop’s payment scanner');
          }
          timer = setTimeout(scan, 250);
        };
        scan();
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow the camera for this site, or use the Camera / Gallery buttons.'
          : 'Could not open the camera. Use the Camera / Gallery buttons instead.');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="qr-scanner" role="dialog" aria-label="Scan shop QR">
      <div className="qr-scanner-box">
        {error ? (
          <p className="qr-scanner-error">{error}</p>
        ) : (
          <>
            <video ref={video} playsInline muted />
            <div className="qr-frame" aria-hidden="true" />
            <p className="qr-scanner-status">{status}</p>
          </>
        )}
        <canvas ref={canvas} hidden />
        <button type="button" className="btn btn-ghost qr-scanner-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

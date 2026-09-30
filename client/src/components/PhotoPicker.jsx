import { useEffect, useRef, useState } from 'react';

// Pick a photo with the camera or from the gallery, with a small preview.
// On phones "Camera" opens the camera directly; "Gallery" lets people choose an existing photo/screenshot.
export default function PhotoPicker({ label, file, onFile, hasExisting = false, gallery = true, camera = true, cameraFirst = true }) {
  const camRef = useRef(null);
  const galRef = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onFile(f);
  };

  const buttons = [
    camera && <button type="button" key="cam" className="btn btn-ghost btn-sm" onClick={() => camRef.current.click()}>📷 Camera</button>,
    gallery && <button type="button" key="gal" className="btn btn-ghost btn-sm" onClick={() => galRef.current.click()}>🖼️ Gallery</button>,
  ];

  return (
    <div className={`photo-picker ${file ? 'has-file' : ''}`}>
      <div className="photo-picker-preview">
        {preview ? <img src={preview} alt="" /> : <span>{hasExisting ? '✓' : '📷'}</span>}
      </div>
      <div className="photo-picker-body">
        <b>{label}</b>
        <small className="muted">{file ? file.name : hasExisting ? 'Already added — choose again to replace' : 'Take a photo or choose one'}</small>
        <div className="photo-picker-buttons">
          {cameraFirst ? buttons : buttons.reverse()}
          {file && <button type="button" className="link-btn" onClick={() => onFile(null)}>Remove</button>}
        </div>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={galRef} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  );
}

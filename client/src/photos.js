// Phone photos are big (3–8 MB). A list photo is still easy to read at 1600 px, so it is made smaller
// before it is kept with the cart (survives a page reload) and sent (faster on mobile data).
export async function shrinkPhoto(file, maxSide = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function dataUrlToFile(dataUrl, name = 'list.jpg') {
  const [head, body] = dataUrl.split(',');
  const bytes = atob(body);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], name, { type: head.match(/data:(.*?);/)?.[1] || 'image/jpeg' });
}

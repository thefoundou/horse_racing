// Profile photos: pick one (phones offer the camera or the photo library),
// crop it square and shrink it to a small JPEG before it leaves the device.

import { toast } from './ui';

const SIZE = 192;

/** Load an image file. (Uses onload rather than img.decode(), which some phones reject for big photos.) */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unreadable'));
    img.src = url;
  });
}

/** A square JPEG data URL of the centre of `file`, SIZE pixels across. */
export async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('empty');
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff'; // photos with transparency get a white background, not black
    g.fillRect(0, 0, SIZE, SIZE);
    g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Open the picker; resolves with the photo, or null if cancelled or unreadable. */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    // Kept in the page until it answers: some phones discard a detached file
    // input while the camera or photo library is open, and the photo is lost.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    let settled = false;
    const finish = (photo: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(photo);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      try {
        finish(await squarePhoto(file));
      } catch {
        toast("That photo couldn't be read. Try another (JPEG or PNG works best).");
        finish(null);
      }
    };
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

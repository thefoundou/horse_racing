// Profile photos: pick one (phones offer the camera or the photo library),
// crop it square and shrink it to a small JPEG before it leaves the device.

const SIZE = 192;

/** A square JPEG data URL of the centre of `file`, SIZE pixels across. */
export async function squarePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Open the picker; resolves with the photo, or null if cancelled. */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve(await squarePhoto(file)); } catch { resolve(null); }
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

import qrcode from 'qrcode-generator';

/** An SVG QR code for `text`, scaling to its container's width. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ margin: 2, scalable: true });
}

/** The link that joins a lobby. */
export const joinUrl = (code: string) => `${location.origin}/${code}`;

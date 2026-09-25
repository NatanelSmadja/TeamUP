export const MAX_AVATAR_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 50 * 1024;
export const TARGET_AVATAR_BYTES = 20 * 1024;

export async function validateAvatarSource(file: File) {
  if (!file.size || file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('יש לבחור תמונה עד 10MB');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((byte,i) => bytes[i] === byte);
  const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('יש לבחור תמונת JPG, PNG או WebP. אפשר להמיר HEIC ל־JPG לפני הבחירה.');
}

export async function compressAvatar(file: File): Promise<Blob> {
  await validateAvatarSource(file);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode().catch(() => {throw new Error('לא ניתן לקרוא את התמונה. נסה קובץ אחר.');});
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('התמונה גדולה מדי לעיבוד. בחר גרסה מוקטנת.');
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('הדפדפן לא הצליח לעבד את התמונה');
    let smallest: Blob | null = null;
    for (const size of [256,192,128]) {
      canvas.width = canvas.height = Math.min(size,crop);
      context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,(image.naturalWidth-crop)/2,(image.naturalHeight-crop)/2,crop,crop,0,0,canvas.width,canvas.height);
      for (const quality of [0.75,0.6,0.45]) {
        const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve,type,quality));
        let blob = await encode('image/webp');
        if (blob?.type !== 'image/webp') blob = await encode('image/jpeg');
        if (!blob || !['image/webp','image/jpeg'].includes(blob.type)) continue;
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= TARGET_AVATAR_BYTES) return blob;
      }
    }
    if (smallest && smallest.size <= MAX_AVATAR_BYTES) return smallest;
    throw new Error('לא הצלחנו להקטין את התמונה מספיק. נסה תמונה אחרת.');
  } finally {URL.revokeObjectURL(url);}
}

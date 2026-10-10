import sharp from "sharp";
import { ExtractionError } from "../../domain/ingestion/content";

export const IMAGE_LIMITS = {
  // Vision models turn pixels into input tokens; a 1600px long side keeps screenshot text legible.
  maxSide: Number(process.env.OCR_MAX_IMAGE_SIDE ?? 1600),
  // Rejects decompression bombs before any pixel is decoded.
  maxInputPixels: 100_000_000,
  // OCR runs on horizontal strips no taller than this, so one call never has to transcribe a whole dense screen.
  tileHeight: Number(process.env.OCR_TILE_HEIGHT ?? 800),
  // Strips share this many pixels so a text line cut at a boundary is whole in one of them.
  tileOverlap: Number(process.env.OCR_TILE_OVERLAP ?? 64),
};

// Returns PNG bytes no larger than maxSide on either edge; the stored original is never changed.
export async function prepareForOcr(image: Uint8Array): Promise<Uint8Array> {
  try {
    const pipeline = sharp(image, {
      limitInputPixels: IMAGE_LIMITS.maxInputPixels,
    }).rotate();
    const { width = 0, height = 0 } = await pipeline.metadata();
    if (Math.max(width, height) <= IMAGE_LIMITS.maxSide)
      return new Uint8Array(await pipeline.png().toBuffer());
    return new Uint8Array(
      await pipeline
        .resize({
          width: IMAGE_LIMITS.maxSide,
          height: IMAGE_LIMITS.maxSide,
          fit: "inside",
        })
        .png()
        .toBuffer(),
    );
  } catch (error) {
    throw new ExtractionError(
      "CORRUPT_FILE",
      `이미지를 읽을 수 없거나 픽셀 한도를 넘습니다: ${(error as Error).message.slice(0, 200)}`,
    );
  }
}

// Splits a prepared image into overlapping top-to-bottom strips; a short image is returned unchanged.
export async function splitForOcr(image: Uint8Array): Promise<Uint8Array[]> {
  const { tileHeight, tileOverlap } = IMAGE_LIMITS;
  const { width = 0, height = 0 } = await sharp(image).metadata();
  if (height <= tileHeight) return [image];
  const step = tileHeight - tileOverlap;
  const tops: number[] = [];
  for (let top = 0; top + tileHeight < height; top += step) tops.push(top);
  tops.push(height - tileHeight);
  return Promise.all(
    tops.map(
      async (top) =>
        new Uint8Array(
          await sharp(image)
            .extract({ left: 0, top, width, height: tileHeight })
            .png()
            .toBuffer(),
        ),
    ),
  );
}

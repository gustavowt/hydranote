import { createFile } from '@/services/projectService';
import { loadImageGenerationSettings } from '@/services/llmService';

export interface SavePastedImageOptions {
  projectId: string;
  binaryData: Uint8Array;
  mimeType: string;
  altText?: string;
  filenamePrefix?: string;
}

export interface SavePastedImageResult {
  filePath: string;
  markdown: string;
}

function mimeToExt(mimeType: string): 'png' | 'jpg' | 'jpeg' | 'webp' {
  const ext = (mimeType.split('/')[1] || 'png').toLowerCase();
  if (ext === 'jpeg') return 'jpg';
  if (ext === 'png' || ext === 'jpg' || ext === 'webp') return ext;
  return 'png';
}

export async function savePastedImage(
  opts: SavePastedImageOptions,
): Promise<SavePastedImageResult> {
  const { projectId, binaryData, mimeType, altText = 'pasted image', filenamePrefix = 'pasted' } = opts;
  const imgSettings = loadImageGenerationSettings();
  const dir = imgSettings.defaultImageDirectory || 'images';
  const ext = mimeToExt(mimeType);
  const timestamp = Date.now();
  const filePath = `${dir}/${filenamePrefix}-${timestamp}.${ext}`;

  await createFile(
    projectId,
    filePath,
    `[Pasted image: ${altText}]`,
    ext,
    binaryData,
  );

  return {
    filePath,
    markdown: `![${altText}](${filePath})`,
  };
}

export async function readClipboardImage(
  clipboardData: DataTransfer,
): Promise<{ binaryData: Uint8Array; mimeType: string } | null> {
  const items = Array.from(clipboardData.items || []);
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (file) {
      const buffer = await file.arrayBuffer();
      return { binaryData: new Uint8Array(buffer), mimeType: file.type || 'image/png' };
    }
  }

  const files = Array.from(clipboardData.files || []);
  const imageFile = files.find((f) => f.type.startsWith('image/'));
  if (imageFile) {
    const buffer = await imageFile.arrayBuffer();
    return { binaryData: new Uint8Array(buffer), mimeType: imageFile.type || 'image/png' };
  }

  return null;
}

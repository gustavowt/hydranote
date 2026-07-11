import { describe, expect, test, vi, beforeEach } from 'vitest';
import { savePastedImage } from '@/services/editorImagePaste';

vi.mock('@/services/projectService', () => ({
  createFile: vi.fn().mockResolvedValue({ id: 'file-1' }),
}));

vi.mock('@/services/imageGenerationService', () => ({
  loadImageGenerationSettings: vi.fn(() => ({ defaultImageDirectory: 'images' })),
}));

import { createFile } from '@/services/projectService';

describe('editorImagePaste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('savePastedImage creates file and returns markdown path', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = await savePastedImage({
      projectId: 'proj-1',
      binaryData: data,
      mimeType: 'image/png',
      altText: 'screenshot',
    });

    expect(createFile).toHaveBeenCalledWith(
      'proj-1',
      expect.stringMatching(/^images\/pasted-\d+\.png$/),
      '[Pasted image: screenshot]',
      'png',
      data,
    );
    expect(result.markdown).toMatch(/^!\[screenshot\]\(images\/pasted-\d+\.png\)$/);
    expect(result.filePath).toMatch(/^images\/pasted-\d+\.png$/);
  });
});

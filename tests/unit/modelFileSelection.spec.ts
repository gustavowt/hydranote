import { describe, expect, test } from 'vitest';
import { selectDownloadableModelFiles } from '../../electron/src/modelFileSelection';

describe('selectDownloadableModelFiles', () => {
  test('selects the complete preferred quantized shard group', () => {
    const files = [
      { filename: 'qwen2.5-7b-instruct-fp16-00001-of-00004.gguf', size: 10 },
      { filename: 'qwen2.5-7b-instruct-fp16-00002-of-00004.gguf', size: 10 },
      { filename: 'qwen2.5-7b-instruct-fp16-00003-of-00004.gguf', size: 10 },
      { filename: 'qwen2.5-7b-instruct-fp16-00004-of-00004.gguf', size: 10 },
      { filename: 'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf', size: 4 },
      { filename: 'qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf', size: 1 },
    ];

    const selected = selectDownloadableModelFiles(files);

    expect(selected.map(file => file.filename)).toEqual([
      'qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf',
      'qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf',
    ]);
  });
});

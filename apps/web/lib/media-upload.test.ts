import { describe, expect, it } from 'vitest';
import {
  hasExpectedMediaSignature,
  readSingleFileMultipart,
} from './media-upload';

describe('media upload validation', () => {
  it('validates declared image and MP4 signatures', () => {
    expect(
      hasExpectedMediaSignature(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        'image/png',
      ),
    ).toBe(true);
    expect(
      hasExpectedMediaSignature(
        new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
        'video/mp4',
      ),
    ).toBe(true);
    expect(
      hasExpectedMediaSignature(
        new TextEncoder().encode('not an image'),
        'image/png',
      ),
    ).toBe(false);
  });

  it('rejects duplicate file parts and duplicate text fields', async () => {
    const duplicateFiles = new FormData();
    duplicateFiles.append(
      'file',
      new File(['a'], 'a.png', { type: 'image/png' }),
    );
    duplicateFiles.append(
      'file',
      new File(['b'], 'b.png', { type: 'image/png' }),
    );
    const duplicateFileResult = await readSingleFileMultipart(
      new Request('http://localhost', { method: 'POST', body: duplicateFiles }),
    );
    expect(duplicateFileResult.success).toBe(false);

    const duplicateFields = new FormData();
    duplicateFields.append(
      'file',
      new File(['a'], 'a.png', { type: 'image/png' }),
    );
    duplicateFields.append('promptHint', 'first');
    duplicateFields.append('promptHint', 'second');
    const duplicateFieldResult = await readSingleFileMultipart(
      new Request('http://localhost', {
        method: 'POST',
        body: duplicateFields,
      }),
    );
    expect(duplicateFieldResult.success).toBe(false);
  });
});

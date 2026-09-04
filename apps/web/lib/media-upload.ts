import { Buffer } from 'node:buffer';
import { jsonFail } from './http';

export async function readSingleFileMultipart(
  request: Request,
  fileField = 'file',
) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return {
      success: false as const,
      response: jsonFail(
        'INVALID_MULTIPART_BODY',
        'Request body must be valid multipart form data',
        400,
      ),
    };
  }

  const fileValues = formData.getAll(fileField);
  if (fileValues.length !== 1 || !(fileValues[0] instanceof File)) {
    return {
      success: false as const,
      response: jsonFail(
        'VALIDATION_ERROR',
        fileValues.length > 1
          ? 'Exactly one file is required'
          : 'File is required',
        400,
      ),
    };
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === fileField) continue;
    if (typeof value !== 'string') {
      return {
        success: false as const,
        response: jsonFail(
          'VALIDATION_ERROR',
          `Multipart field ${key} must be text`,
          400,
        ),
      };
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      return {
        success: false as const,
        response: jsonFail(
          'VALIDATION_ERROR',
          `Multipart field ${key} must not be repeated`,
          400,
        ),
      };
    }
    fields[key] = value;
  }

  return { success: true as const, file: fileValues[0], fields };
}

export function hasExpectedMediaSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    return (
      bytes.length >= signature.length &&
      signature.every((byte, index) => bytes[index] === byte)
    );
  }
  if (mimeType === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'video/mp4') {
    return (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
    );
  }
  return false;
}

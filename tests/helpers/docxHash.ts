import crypto from 'crypto';
import path from 'path';
// Using require for mammoth because its TS types don't play well with ESM-style imports here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

/**
 * Short hex hash of a .docx file's whitespace-normalised raw text.
 * Stable across trivial editor reformats but changes on any text edit.
 */
export async function docxTextHash(relativePath: string): Promise<string> {
  const abs = path.resolve(__dirname, '..', '..', relativePath);
  const { value } = await mammoth.extractRawText({ path: abs });
  const normalised = value.replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

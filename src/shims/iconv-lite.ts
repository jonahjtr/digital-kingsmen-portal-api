/** Minimal iconv-lite shim for Cloudflare Workers (UTF-8 only). */
const iconv = {
  encode: (str: string, encoding: string) => {
    if (encoding === 'utf8' || encoding === 'utf-8') return Buffer.from(str, 'utf8');
    throw new Error(`iconv-lite shim: unsupported encoding ${encoding}`);
  },
  decode: (buf: Buffer, encoding: string) => {
    if (encoding === 'utf8' || encoding === 'utf-8') return buf.toString('utf8');
    throw new Error(`iconv-lite shim: unsupported encoding ${encoding}`);
  },
};

export default iconv;

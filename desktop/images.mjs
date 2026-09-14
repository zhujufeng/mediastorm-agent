export const imageLimit = 4 * 1024 * 1024;
export function imageInput(value, pngOnly = false) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['mimeType', 'data'].includes(key)) ||
      !(pngOnly ? ['image/png'] : ['image/png', 'image/jpeg']).includes(value.mimeType) ||
      typeof value.data !== 'string' || !value.data.length || value.data.length > Math.ceil(imageLimit / 3) * 4 ||
      value.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new Error('截图须为4MiB以内的PNG或JPEG图片。');
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length > imageLimit || bytes.toString('base64') !== value.data) throw new Error('截图编码或大小无效。');
  if (value.mimeType === 'image/png') {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG截图格式无效。');
    imageSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  } else {
    if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('JPEG截图格式无效。');
    let found = false;
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || found) throw new Error('JPEG截图帧头无效。');
        imageSize(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
        found = true;
      }
      offset += length;
    }
    if (!found) throw new Error('JPEG截图尺寸或编码不支持。');
  }
  return bytes;
}
export function imageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('截图最长边不能超过4096像素，请先裁剪或缩小。');
}

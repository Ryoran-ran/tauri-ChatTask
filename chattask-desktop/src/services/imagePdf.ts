const encoder = new TextEncoder();

const concatBytes = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.byteLength;
  });
  return result;
};

/** JPEG画像をA3以内の原画比率に合う1ページPDFへ格納する。 */
export const createImagePdf = (jpegBuffer: ArrayBuffer, imageWidth: number, imageHeight: number) => {
  const maxPageWidth = 1_190.55;
  const maxPageHeight = 841.89;
  const margin = 24;
  const maxContentWidth = maxPageWidth - margin * 2;
  const maxContentHeight = maxPageHeight - margin * 2;
  const scale = Math.min(maxContentWidth / imageWidth, maxContentHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;
  const pageWidth = renderedWidth + margin * 2;
  const pageHeight = renderedHeight + margin * 2;
  const left = (pageWidth - renderedWidth) / 2;
  const bottom = (pageHeight - renderedHeight) / 2;
  const jpeg = new Uint8Array(jpegBuffer);
  const parts: Uint8Array[] = [];
  const offsets = [0];
  let byteLength = 0;
  const append = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    byteLength += bytes.byteLength;
  };
  const beginObject = (id: number) => {
    offsets[id] = byteLength;
    append(`${id} 0 obj\n`);
  };

  append("%PDF-1.4\n%ChatTask\n");
  beginObject(1);
  append("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObject(2);
  append("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  beginObject(3);
  append(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  beginObject(4);
  append(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`);
  append(jpeg);
  append("\nendstream\nendobj\n");
  const content = `q\n${renderedWidth.toFixed(3)} 0 0 ${renderedHeight.toFixed(3)} ${left.toFixed(3)} ${bottom.toFixed(3)} cm\n/Im0 Do\nQ\n`;
  beginObject(5);
  append(`<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}endstream\nendobj\n`);

  const xrefOffset = byteLength;
  append("xref\n0 6\n0000000000 65535 f \n");
  for (let id = 1; id <= 5; id += 1) append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  const pdf = concatBytes(parts);
  return new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
};

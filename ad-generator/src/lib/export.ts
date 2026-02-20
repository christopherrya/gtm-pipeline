import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export async function exportSinglePng(element: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(element, {
    quality: 1,
    pixelRatio: 1,
    cacheBust: true,
  });

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export async function exportBulkZip(
  elements: { element: HTMLElement; filename: string }[]
): Promise<void> {
  const zip = new JSZip();

  for (const { element, filename } of elements) {
    const dataUrl = await toPng(element, {
      quality: 1,
      pixelRatio: 1,
      cacheBust: true,
    });

    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    zip.file(filename, blob);
  }

  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, 'discloser-ads.zip');
}

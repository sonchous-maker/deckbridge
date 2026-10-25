export function bytesToDataUri(bytes: Uint8Array | number[], mimeType: string): string {
  return `${mimeType};base64,${bytesToBase64(bytes)}`;
}

export function svgToDataUri(svg: string): string {
  return `image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
}

function bytesToBase64(bytes: Uint8Array | number[]): string {
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < array.length; index += chunkSize) {
    const chunk = array.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

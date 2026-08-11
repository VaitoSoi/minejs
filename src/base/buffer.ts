export function sliceBuffer<T = Buffer>(
    buf: Buffer, 
    byteLength: number, 
    transform?: (buf: Buffer, ind: number) => T
): T[] {
    const chunks: Buffer[] = [];
    for (let i = 0; i < buf.length; i += byteLength)
        chunks.push(buf.subarray(i, i + byteLength));
    if (transform)
        return chunks.map(transform);
    return chunks as T[];
}
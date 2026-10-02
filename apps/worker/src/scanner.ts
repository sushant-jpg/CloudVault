import net from 'node:net';
import type { Readable } from 'node:stream';
import { getConfig } from '@cloudvault/config';

export interface ScanResult { clean: boolean; signature?: string; raw: string }
export interface MalwareScanner { scan(stream: Readable): Promise<ScanResult> }

export class ClamAvScanner implements MalwareScanner {
  async scan(stream: Readable): Promise<ScanResult> {
    const config = getConfig();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: config.CLAMAV_HOST, port: config.CLAMAV_PORT });
      let response = '';
      socket.setTimeout(60_000);
      socket.on('connect', async () => {
        socket.write('zINSTREAM\0');
        try {
          for await (const chunk of stream) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(data.length);
            socket.write(size);
            socket.write(data);
          }
          socket.write(Buffer.alloc(4));
        } catch (error) { socket.destroy(error as Error); }
      });
      socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
      socket.on('end', () => {
        const clean = response.includes('OK');
        const match = response.match(/: (.+) FOUND/);
        if (!clean && !match) { reject(new Error(`ClamAV scan failed: ${response.trim()}`)); return; }
        resolve({ clean, signature: match?.[1], raw: response.trim() });
      });
      socket.on('timeout', () => socket.destroy(new Error('ClamAV scan timed out')));
      socket.on('error', reject);
    });
  }
}

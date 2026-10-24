/**
 * Legacy compressed API responses are intentionally unsupported in offline
 * mode. Bundled snapshots are plain JSON and are loaded by src/offline.
 */
export class Zip {
  static decompress = async (_file: Uint8Array): Promise<Uint8Array> => {
    throw new Error('离线版不下载或解压远程 API 数据。')
  }
}

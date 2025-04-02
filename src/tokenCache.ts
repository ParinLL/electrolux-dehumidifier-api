import fs from 'fs';
import path from 'path';
import { Logging } from 'homebridge';

export interface TokenCacheData {
  accessToken: string;
  refreshToken: string;
  tokenExpiryTime: number;
  lastRefreshTime: number;
}

export class TokenCache {
  private readonly cacheFilePath: string;

  constructor(
    private readonly applianceId: string,
    private readonly log: Logging,
    storagePath?: string,
  ) {
    // Use the provided storage path or default to the user's home directory
    const basePath = storagePath || path.join(process.env.HOME || process.env.USERPROFILE || '', '.homebridge');
    
    // Ensure the directory exists
    const cacheDir = path.join(basePath, 'electrolux-cache');
    if (!fs.existsSync(cacheDir)) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch (error) {
        this.log.error('Failed to create cache directory:', error);
      }
    }
    
    // Set the cache file path
    this.cacheFilePath = path.join(cacheDir, `${this.applianceId}.json`);
    this.log.debug(`Token cache file path: ${this.cacheFilePath}`);
  }

  /**
   * Load token data from cache file
   */
  loadCache(): TokenCacheData | null {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf8');
        const cache = JSON.parse(data) as TokenCacheData;
        this.log.debug('Loaded token cache from file');
        return cache;
      }
    } catch (error) {
      this.log.error('Failed to load token cache:', error);
    }
    
    return null;
  }

  /**
   * Save token data to cache file
   */
  saveCache(data: TokenCacheData): void {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf8');
      this.log.debug('Saved token cache to file');
    } catch (error) {
      this.log.error('Failed to save token cache:', error);
    }
  }
}

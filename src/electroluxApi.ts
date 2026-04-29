import axios, { AxiosInstance } from 'axios';
import { Logging } from 'homebridge';
import { TokenCache } from './tokenCache.js';

export interface ApplianceCommand {
  cleanAirMode?: 'ON' | 'OFF';
  mode?: 'AUTO' | 'DRY' | 'QUIET';
  executeCommand?: 'OFF';
}

export interface ElectroluxConfig {
  apiKey: string;
  refreshToken: string;
  applianceId: string;
  debug?: boolean;
  storagePath?: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  refreshToken: string;
  scope: string;
}

export interface ApplianceState {
  sensorHumidity: number;
  applianceState: string;
  mode: string;
}

export class ElectroluxApi {
  private readonly apiBaseUrl = 'https://api.developer.electrolux.one/api/v1';
  private accessToken: string | null = null;
  private tokenExpiryTime = 0;
  private lastRefreshTime = 0;
  private axiosInstance: AxiosInstance;
  private tokenCache: TokenCache;
  private readonly MIN_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

  constructor(
    private readonly config: ElectroluxConfig,
    private readonly log: Logging,
  ) {
    this.axiosInstance = axios.create({
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
    });

    this.tokenCache = new TokenCache(this.config.applianceId, this.log, this.config.storagePath);

    const cachedToken = this.tokenCache.loadCache();
    if (cachedToken) {
      this.accessToken = cachedToken.accessToken;
      this.config.refreshToken = cachedToken.refreshToken;
      this.tokenExpiryTime = cachedToken.tokenExpiryTime;
      this.lastRefreshTime = cachedToken.lastRefreshTime;
      this.log.debug('Loaded token from cache');
    } else {
      this.tokenExpiryTime = Date.now();
    }
  }

  private async ensureValidToken(): Promise<void> {
    const now = Date.now();

    if (this.accessToken && this.tokenExpiryTime > now + 300000) {
      return;
    }

    if (this.accessToken && this.lastRefreshTime > 0 && (now - this.lastRefreshTime) < this.MIN_REFRESH_INTERVAL) {
      this.log.debug('Token refreshed recently, reusing existing token');
      return;
    }

    try {
      this.log.debug('Refreshing access token');
      const response = await this.axiosInstance.post<TokenResponse>(
        `${this.apiBaseUrl}/token/refresh`,
        { refreshToken: this.config.refreshToken },
        { headers: { 'x-api-key': this.config.apiKey } },
      );

      this.accessToken = response.data.accessToken;
      if (response.data.refreshToken) {
        this.config.refreshToken = response.data.refreshToken;
      }
      this.tokenExpiryTime = Date.now() + (response.data.expiresIn - 300) * 1000;
      this.lastRefreshTime = Date.now();

      this.tokenCache.saveCache({
        accessToken: this.accessToken,
        refreshToken: this.config.refreshToken,
        tokenExpiryTime: this.tokenExpiryTime,
        lastRefreshTime: this.lastRefreshTime,
      });

      this.log.debug(`Token refreshed, expires in ${response.data.expiresIn}s`);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.log.error('Refresh token is invalid or expired. Please obtain a new one.');
      }
      throw new Error('Failed to refresh access token');
    }
  }

  async getApplianceState(): Promise<ApplianceState> {
    await this.ensureValidToken();

    try {
      const url = `${this.apiBaseUrl}/appliances/${this.config.applianceId}/state`;
      const response = await this.axiosInstance.get(url, {
        headers: {
          'x-api-key': this.config.apiKey,
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      const props = response.data.properties.reported;
      return {
        sensorHumidity: props.sensorHumidity,
        applianceState: props.applianceState,
        mode: props.mode,
      };
    } catch (error) {
      this.log.error('Failed to get appliance state:', error instanceof Error ? error.message : String(error));
      throw new Error('Failed to get appliance state');
    }
  }

  async turnOn(): Promise<void> {
    this.log.debug('Turning on (AUTO + cleanAirMode ON)');
    await this.sendCommand({ mode: 'AUTO' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.sendCommand({ cleanAirMode: 'ON' });
  }

  async turnOff(): Promise<void> {
    this.log.debug('Turning off');
    await this.sendCommand({ executeCommand: 'OFF' });
  }

  async setMode(mode: 'AUTO' | 'DRY' | 'QUIET'): Promise<void> {
    await this.sendCommand({ mode });
  }

  private async sendCommand(command: ApplianceCommand): Promise<void> {
    await this.ensureValidToken();

    try {
      const url = `${this.apiBaseUrl}/appliances/${this.config.applianceId}/command`;
      await this.axiosInstance.put(url, command, {
        headers: {
          'x-api-key': this.config.apiKey,
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      this.log.debug('Command sent:', JSON.stringify(command));
    } catch (error) {
      this.log.error('Failed to send command:', error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to send command: ${JSON.stringify(command)}`);
    }
  }
}

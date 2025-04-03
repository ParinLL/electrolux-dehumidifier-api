import axios, { AxiosInstance } from 'axios';
import { Logging } from 'homebridge';
import { TokenCache } from './tokenCache.js';

/**
 * Command types that can be sent to the appliance
 */
export interface ApplianceCommand {
  cleanAirMode?: 'ON' | 'OFF';
  mode?: 'AUTO' | 'DRY' | 'QUIET';
  targetHumidity?: number;
  fanSpeedSetting?: 'HIGH' | 'MIDDLE' | 'LOW';
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
  cleanAirMode: string;
  targetHumidity: number;
  fanSpeedSetting: string;
  sensorHumidity: number;
  mode: string;
  applianceState: string;
  filterState: string;
  waterBucketLevel: number;
}

export class ElectroluxApi {
  private readonly apiBaseUrl = 'https://api.developer.electrolux.one/api/v1';
  private readonly tokenRefreshUrl = `${this.apiBaseUrl}/token/refresh`;
  private readonly applianceStateUrl = `${this.apiBaseUrl}/appliances`;
  private readonly applianceCommandUrl = `${this.apiBaseUrl}/appliances`;
  
  private accessToken: string | null = null;
  private tokenExpiryTime: number = 0;
  private lastRefreshTime: number = 0;
  private axiosInstance: AxiosInstance;
  private tokenCache: TokenCache;
  
  // Minimum time between refresh token requests (6 hours in milliseconds)
  private readonly MIN_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
  
  constructor(
    private readonly config: ElectroluxConfig,
    private readonly log: Logging,
  ) {
    this.axiosInstance = axios.create({
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
    });
    
    // Initialize token cache
    this.tokenCache = new TokenCache(
      this.config.applianceId,
      this.log,
      this.config.storagePath,
    );
    
    // Try to load token from cache
    const cachedToken = this.tokenCache.loadCache();
    if (cachedToken) {
      this.accessToken = cachedToken.accessToken;
      this.config.refreshToken = cachedToken.refreshToken;
      this.tokenExpiryTime = cachedToken.tokenExpiryTime;
      this.lastRefreshTime = cachedToken.lastRefreshTime;
      
      this.log.debug('Loaded token from cache, expires at: ' + new Date(this.tokenExpiryTime).toISOString());
    } else {
      // Set token expiry time to force a refresh on first API call
      this.tokenExpiryTime = Date.now();
      this.lastRefreshTime = 0;
    }
  }
  
  /**
   * Ensures we have a valid access token before making API calls
   */
  private async ensureValidToken(): Promise<void> {
    const now = Date.now();
    
    // If token is still valid (with 5 minute buffer), return
    if (this.accessToken && this.tokenExpiryTime > now + 300000) {
      return;
    }
    
    // Check if we've refreshed the token recently (within 6 hours)
    // Only enforce this if we already have a token (to allow initial token acquisition)
    if (this.accessToken && this.lastRefreshTime > 0) {
      const timeSinceLastRefresh = now - this.lastRefreshTime;
      
      if (timeSinceLastRefresh < this.MIN_REFRESH_INTERVAL) {
        this.log.debug(`Token was refreshed recently (${Math.round(timeSinceLastRefresh / 60000)} minutes ago). Using existing token.`);
        
        // If the token is expired but we can't refresh yet, we'll try to use it anyway
        // The API might still accept it, and if not, we'll handle the error
        return;
      }
    }
    
    try {
      this.log.debug('Refreshing access token');
      
      // Add additional headers that might be required by the API
      const response = await this.axiosInstance.post<TokenResponse>(
        this.tokenRefreshUrl,
        { refreshToken: this.config.refreshToken },
        {
          headers: {
            'x-api-key': this.config.apiKey,
          },
        },
      );
      
      this.accessToken = response.data.accessToken;
      
      // Update refresh token if a new one was provided
      if (response.data.refreshToken) {
        this.config.refreshToken = response.data.refreshToken;
        this.log.debug('Received new refresh token');
      }
      
      // Set token expiry time (subtract 5 minutes for safety)
      const expiresInMs = (response.data.expiresIn - 300) * 1000;
      this.tokenExpiryTime = Date.now() + expiresInMs;
      
      // Update last refresh time
      this.lastRefreshTime = Date.now();
      
      // Save to cache
      this.tokenCache.saveCache({
        accessToken: this.accessToken,
        refreshToken: this.config.refreshToken,
        tokenExpiryTime: this.tokenExpiryTime,
        lastRefreshTime: this.lastRefreshTime,
      });
      
      this.log.debug(`Token refreshed, expires in ${response.data.expiresIn} seconds`);
    } catch (error) {
      // Log more detailed error information
      if (axios.isAxiosError(error) && error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        this.log.error(`Token refresh failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        
        // If the refresh token is invalid or expired, we need to inform the user
        if (error.response.status === 401) {
          this.log.error('Your refresh token appears to be invalid or expired. Please obtain a new refresh token from the Electrolux API.');
        }
      } else if (axios.isAxiosError(error) && error.request) {
        // The request was made but no response was received
        this.log.error('No response received from token refresh request:', error.request);
      } else {
        // Something happened in setting up the request that triggered an Error
        this.log.error('Error setting up token refresh request:', error instanceof Error ? error.message : String(error));
      }
      
      throw new Error('Failed to refresh access token');
    }
  }
  
  /**
   * Get the current state of the appliance
   */
  async getApplianceState(): Promise<ApplianceState> {
    await this.ensureValidToken();
    
    try {
      const url = `${this.applianceStateUrl}/${this.config.applianceId}/state`;
      
      const response = await this.axiosInstance.get(url, {
        headers: {
          'x-api-key': this.config.apiKey,
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      
      const reportedProps = response.data.properties.reported;
      
      // Extract the properties we're interested in
      const state: ApplianceState = {
        cleanAirMode: reportedProps.cleanAirMode,
        targetHumidity: reportedProps.targetHumidity,
        fanSpeedSetting: reportedProps.fanSpeedSetting,
        sensorHumidity: reportedProps.sensorHumidity,
        mode: reportedProps.mode,
        applianceState: reportedProps.applianceState,
        filterState: reportedProps.filterState,
        waterBucketLevel: reportedProps.waterBucketLevel,
      };
      
      if (this.config.debug) {
        this.log.debug('Appliance state:', JSON.stringify(state, null, 2));
      }
      
      return state;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        this.log.error(`Failed to get appliance state with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else {
        this.log.error('Failed to get appliance state:', error instanceof Error ? error.message : String(error));
      }
      throw new Error('Failed to get appliance state');
    }
  }
  
  /**
   * Set the clean air mode (ON/OFF)
   */
  async setCleanAirMode(mode: 'ON' | 'OFF'): Promise<void> {
    await this.sendCommand({ cleanAirMode: mode });
  }
  
  /**
   * Set the operation mode (AUTO/DRY/QUIET)
   */
  async setMode(mode: 'AUTO' | 'DRY' | 'QUIET'): Promise<void> {
    await this.sendCommand({ mode });
  }
  
  /**
   * Set the target humidity (40-60, step by 5)
   * Note: Can only be set when in DRY mode
   */
  async setTargetHumidity(humidity: number): Promise<void> {
    // Ensure humidity is within valid range and step
    const validHumidity = Math.min(Math.max(Math.round(humidity / 5) * 5, 40), 60);
    
    await this.sendCommand({ targetHumidity: validHumidity });
  }
  
  /**
   * Set the fan speed (HIGH/MIDDLE/LOW)
   */
  async setFanSpeed(speed: 'HIGH' | 'MIDDLE' | 'LOW'): Promise<void> {
    await this.sendCommand({ fanSpeedSetting: speed });
  }
  
  /**
   * Turn the appliance off
   */
  async turnOff(): Promise<void> {
    await this.sendCommand({ executeCommand: 'OFF' });
  }
  
  /**
   * Turn the appliance on with AUTO mode and clean air mode ON
   * First sets mode to AUTO, waits 1 second, then sets cleanAirMode to ON
   */
  async turnOn(): Promise<void> {
    // First set mode to AUTO
    await this.sendCommand({ mode: 'AUTO' });
    
    // Wait for 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Then set cleanAirMode to ON
    await this.sendCommand({ cleanAirMode: 'ON' });
  }
  
  /**
   * Send a command to the appliance
   */
  private async sendCommand(command: ApplianceCommand): Promise<void> {
    await this.ensureValidToken();
    
    try {
      const url = `${this.applianceCommandUrl}/${this.config.applianceId}/command`;
      
      if (this.config.debug) {
        this.log.debug('Sending command:', JSON.stringify(command, null, 2));
      }
      
      await this.axiosInstance.put(
        url,
        command,
        {
          headers: {
            'x-api-key': this.config.apiKey,
            'Authorization': `Bearer ${this.accessToken}`,
          },
        },
      );
      
      this.log.debug('Command sent successfully');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        this.log.error(`Failed to send command with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else {
        this.log.error('Failed to send command:', error instanceof Error ? error.message : String(error));
      }
      throw new Error(`Failed to send command: ${JSON.stringify(command)}`);
    }
  }
}

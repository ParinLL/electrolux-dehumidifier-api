# Homebridge Electrolux Dehumidifier Plugin

This Homebridge plugin allows you to control your Electrolux dehumidifier with HomeKit. It integrates with the Electrolux API to provide control and monitoring of your dehumidifier.

## Features

- Control dehumidifier power (on/off)
- Set target humidity level (40-60%, in 5% increments)
- Control fan speed (Low, Medium, High)
- Toggle Clean Air Mode
- Monitor current humidity level
- Auto-renewal of access tokens

## Installation

```bash
npm install -g homebridge-electrolux-dehumidifier
```

## Configuration

Add the following to your Homebridge config.json:

```json
{
  "platforms": [
    {
      "platform": "ElectroluxDehumidifier",
      "name": "Electrolux Dehumidifier",
      "apiKey": "YOUR_API_KEY",
      "refreshToken": "YOUR_REFRESH_TOKEN",
      "applianceId": "YOUR_APPLIANCE_ID",
      "pollingInterval": 60,
      "debug": false
    }
  ]
}
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `platform` | Must be "ElectroluxDehumidifier" |
| `name` | Name of your dehumidifier in HomeKit |
| `apiKey` | Your Electrolux API key (x-api-key) |
| `refreshToken` | Your Electrolux refresh token |
| `applianceId` | Your Electrolux dehumidifier appliance ID |
| `pollingInterval` | (Optional) How frequently to poll for updates (in seconds, default: 60) |
| `debug` | (Optional) Enable debug logging (default: false) |

## Obtaining API Credentials

To use this plugin, you need to obtain your API key, refresh token, and appliance ID from Electrolux:

1. Get your API key (x-api-key) from the Electrolux developer portal
2. Use the refresh token from your initial authentication
3. Find your appliance ID by making an API call to list your appliances

## HomeKit Services

This plugin creates the following HomeKit services:

1. **Dehumidifier** - Main service for controlling the dehumidifier
   - Power on/off
   - Target humidity setting
   - Current humidity reading

2. **Fan** - Controls the fan speed
   - Low, Medium, High settings

3. **Switch** - Controls the Clean Air Mode
   - On/Off toggle

4. **Humidity Sensor** - Shows the current humidity level

## Development

```bash
# Clone the repository
git clone https://github.com/USERNAME/homebridge-electrolux-dehumidifier.git
cd homebridge-electrolux-dehumidifier

# Install dependencies
npm install

# Build the plugin
npm run build

# Link for development
npm link
```

## License

Apache-2.0

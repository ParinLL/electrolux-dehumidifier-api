# Homebridge Electrolux Dehumidifier Plugin

This Homebridge plugin allows you to control your Electrolux dehumidifier with HomeKit. It integrates with the Electrolux API to provide basic control of your dehumidifier.

**Note:** This plugin has only been tested on the Electrolux DEHUMIDIFIER ED2171WA model.

## Features

- Control dehumidifier power (on/off)
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

This plugin currently creates the following HomeKit service:

1. **Switch** - Basic on/off control for the dehumidifier

**Note:** While the underlying API supports additional features like humidity control, fan speed settings, and Clean Air Mode, these are not currently exposed as HomeKit services. Future updates may add these capabilities.

## Development

```bash
# Clone the repository
git clone https://github.com/ParinLL/electrolux-dehumidifier-api.git
cd electrolux-dehumidifier-api

# Install dependencies
npm install

# Build the plugin
npm run build

# Link for development
npm link
```

## License

Apache-2.0

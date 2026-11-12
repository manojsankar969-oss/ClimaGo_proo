# Climago | Luxury Weather

A premium weather application that provides real-time insights, smart advice, and local tourist attractions using the OpenWeather and Overpass APIs.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- API Keys:
    - **OpenWeather API Key**: [Get it here](https://openweathermap.org/api)
    - **Google Gemini API Key**: (Optional, for AI summaries) [Get it here](https://aistudio.google.com/)

### Installation
1. Clone the repository or download the source code.
2. Install the necessary dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   - Add your API keys to `.env` in the project root. Keep this file private; the server reads `GOOGLE_API_KEY` and does not send it to the browser.
   - `OPENWEATHER_API_KEY` is required for weather features; `GOOGLE_API_KEY` is optional and enables AI summaries and travel advice.
   - Optional Firebase settings enable Google sign-in and analytics.

### Running the App
1. Start the backend server:
   ```bash
   npm start
   ```
2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## ✨ Features
- **Luxury UI**: Glassmorphic design with premium typography.
- **Smart Comfort Score**: A unique 0-10 metric based on temperature, humidity, and wind.
- **Tourist Highlights**: Shows popular nearby attractions using the Overpass API.
- **Daily Narrative**: A breakdown of the day into Morning, Afternoon, Evening, and Night.
- **AQI & UV Index**: Real-time environmental monitoring.
- **AI Insights**: Weather summaries and travel advice powered by Gemini 3.8 Flash.

## API errors and tests

API errors use a JSON object with an `error` string. Invalid input returns `400`, missing provider configuration returns `503`, AI quota limits return `429`, other provider failures return `502`, and provider timeouts return `504`. Malformed or oversized JSON bodies return `400` or `413`. Successful travel-advice responses contain `{ "advice": "..." }`.

To test the live Gemini-backed route while the server is running, use PowerShell:

```powershell
$body = @{
  city = 'Delhi'
  temp = 25
  humidity = 45
  wind = 2
  condition = 'clear sky'
  airQuality = 3
} | ConvertTo-Json

Invoke-RestMethod -Uri 'http://localhost:3000/api/travel-advice' `
  -Method Post `
  -ContentType 'application/json' `
  -Body $body
```

This command contacts Google Gemini and requires an authorized `GOOGLE_API_KEY` and available quota. Run the automated tests with mocked provider responses instead:

Run the automated tests with:

```bash
npm test
```

## 🛠️ Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js, Express
- **APIs**: OpenWeather (Weather, Forecast, AQI, UV), Overpass (Tourist Points), Google Gemini (AI Summaries)

## 📚 Project Documentation
- [Project overview](./PROJECT_OVERVIEW.md) — what Climago does, how it is structured, and how to run it.
- [Improvement plan](./IMPROVEMENT_PLAN.md) — a prioritized, phased engineering roadmap.
- [MCP integration proposal](./MCP_INTEGRATION.md) — a proposed MCP design; no MCP server is currently implemented.

## 📄 License
MIT License - Feel free to use and modify for your own projects!

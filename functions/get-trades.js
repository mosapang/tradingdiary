const { google } = require('googleapis');

exports.handler = async (event) => {
  const accessToken = event.headers.authorization?.split('Bearer ')[1];
  if (!accessToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.SPREADSHEET_ID;

  try {
    // Fetch Trades
    const tradesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Trades!A:L',
    });
    const tradesRows = tradesRes.data.values || [];
    const headers = tradesRows.shift(); // Remove headers
    const trades = tradesRows.map(row => {
      return headers.reduce((obj, header, i) => {
        obj[header.replace(/ /g, '')] = row[i] || ''; // CamelCase keys
        return obj;
      }, {});
    });

    // Fetch Screenshots
    const screenshotsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Screenshots!A:C',
    });
    const screenshotsRows = screenshotsRes.data.values || [];
    screenshotsRows.shift(); // Remove headers
    const screenshotsMap = {};
    screenshotsRows.forEach(row => {
      const tradeUUID = row[1];
      if (!screenshotsMap[tradeUUID]) screenshotsMap[tradeUUID] = [];
      screenshotsMap[tradeUUID].push(row[2]); // Link
    });

    // Attach screenshots to trades
    trades.forEach(trade => {
      trade.screenshots = screenshotsMap[trade.UUID] || [];
    });

    return {
      statusCode: 200,
      body: JSON.stringify(trades),
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized or server error' }) };
  }
};
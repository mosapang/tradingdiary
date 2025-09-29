const { google } = require('googleapis');
   const { v4: uuidv4 } = require('uuid');
   const busboy = require('busboy');
   const fetch = require('node-fetch');

   exports.handler = async (event) => {
     if (event.httpMethod !== 'POST') {
       return { statusCode: 405, body: 'Method Not Allowed' };
     }

     const idToken = event.headers.authorization?.split('Bearer ')[1];
     if (!idToken) {
       return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
     }

     try {
       // Exchange ID token for access token
       const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
         method: 'POST',
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         body: new URLSearchParams({
           client_id: process.env.CLIENT_ID || event.headers['x-client-id'], // Fallback to header if needed
           client_secret: '', // Not needed for client-side flow
           grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
           assertion: idToken,
         }),
       });

       const tokenData = await tokenResponse.json();
       if (!tokenResponse.ok) {
         return { statusCode: 401, body: JSON.stringify({ error: 'Failed to exchange token', details: tokenData }) };
       }
       const accessToken = tokenData.access_token;

       const auth = new google.auth.OAuth2();
       auth.setCredentials({ access_token: accessToken });

       const drive = google.drive({ version: 'v3', auth });
       const sheets = google.sheets({ version: 'v4', auth });
       const spreadsheetId = process.env.SPREADSHEET_ID;
       const folderId = process.env.FOLDER_ID;

       const { fields, files } = await parseForm(event);

       const tradeUUID = uuidv4();
       const tradeRow = [
         tradeUUID,
         fields.date,
         fields.symbol,
         fields.patternName,
         fields.patternCondition,
         fields.strategy,
         fields.entry,
         fields.stopLoss,
         fields.target,
         fields.exit,
         fields.outcome,
         fields.notes || ''
       ];

       // Append to Trades sheet
       await sheets.spreadsheets.values.append({
         spreadsheetId,
         range: 'Trades!A:L',
         valueInputOption: 'RAW',
         resource: { values: [tradeRow] },
       });

       // Upload screenshots and append to Screenshots sheet
       const screenshotLinks = [];
       for (const file of files) {
         const screenshotID = uuidv4();
         const { data: { id: fileId } } = await drive.files.create({
           requestBody: {
             name: file.filename,
             parents: [folderId],
           },
           media: {
             mimeType: file.mimeType,
             body: file.buffer,
           },
         });

         // Make public (anyone with link can view)
         await drive.permissions.create({
           fileId,
           requestBody: { role: 'reader', type: 'anyone' },
         });

         const link = `https://drive.google.com/uc?export=view&id=${fileId}`;
         screenshotLinks.push(link);

         const screenshotRow = [screenshotID, tradeUUID, link];
         await sheets.spreadsheets.values.append({
           spreadsheetId,
           range: 'Screenshots!A:C',
           valueInputOption: 'RAW',
           resource: { values: [screenshotRow] },
         });
       }

       return {
         statusCode: 200,
         body: JSON.stringify({ message: 'Trade added successfully', tradeUUID }),
       };
     } catch (error) {
       console.error(error);
       return { statusCode: 500, body: JSON.stringify({ error: 'Server error', details: error.message }) };
     }
   };

   function parseForm(event) {
     return new Promise((resolve, reject) => {
       const bb = busboy({ headers: event.headers });
       const fields = {};
       const files = [];

       bb.on('field', (name, val) => { fields[name] = val; });
       bb.on('file', (name, file, info) => {
         const chunks = [];
         file.on('data', (chunk) => chunks.push(chunk));
         file.on('end', () => {
           files.push({
             filename: info.filename,
             mimeType: info.mimeType,
             buffer: Buffer.concat(chunks),
           });
         });
       });
       bb.on('finish', () => resolve({ fields, files }));
       bb.on('error', reject);
       bb.end(Buffer.from(event.body, 'base64'));
     });
   }
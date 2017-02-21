require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const google = require('googleapis');
const googleAuth = require('google-auth-library');
const moment = require('moment');
const logger = require('winston');
const BACKUP_LIST = require('./backup_file_list.json');
const GOOGLE_SECRET = require('./client_secret.json');


logger.level = process.env.LOG_LEVEL || 'debug';
logger.configure({
  level: 'verbose',
  transports: [
    new logger.transports.Console({ colorize: true }),
    new (logger.transports.File)({ filename: 'google-drive-backup.log' })
  ]
});

// ADAPTED FROM
// https://developers.google.com/drive/v3/web/quickstart/nodejs
// https://developers.google.com/drive/v3/web/manage-downloads
// https://developers.google.com/sheets/api/quickstart/nodejs


// GOOGLE DRIVE SCOPES - https://developers.google.com/drive/v3/web/about-auth
// https://www.googleapis.com/auth/drive.metadata.readonly
// https://www.googleapis.com/auth/drive
// https://www.googleapis.com/auth/drive.file
//

const BACKUP_DIR = process.env.BACKUP_DIR;

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_DIR = `${process.env.HOME ||
    process.env.HOMEPATH ||
    process.env.USERPROFILE}/${process.env.TOKEN_DIRECTORY}/`;
const TOKEN_PATH = TOKEN_DIR + process.env.TOKEN_FILENAME;

authorize(GOOGLE_SECRET, processBackup);

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const clientSecret = credentials.installed.client_secret;
  const clientId = credentials.installed.client_id;
  const redirectUrl = credentials.installed.redirect_uris[0];
  const auth = new googleAuth();
  const oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) {
      // removed for cron job - run if token expires or deleted
      // getNewToken(oauth2Client, callback);
      logger.error('Token not on file');
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oauth2Client.getToken(code, (err, token) => {
      if (err) {
        logger.error('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  logger.info(`Token stored to ${TOKEN_PATH}`);
}

/**
 * Lists the names and IDs of up to 10 files.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth) {
  const service = google.drive('v3');

  service.files.list({
    auth,
    pageSize: 10,
    fields: 'nextPageToken, files(id, name)'
  }, (err, response) => {
    if (err) {
      console.log(`The API returned an error: ${err}`);
      return;
    }
    let files = response.files;
    if (files.length == 0) {
      console.log('No files found.');
    } else {
      console.log('Files:');
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        console.log('%s (%s)', file.name, file.id);
      }
    }
  });
}

function processBackup(auth) {
  BACKUP_LIST.forEach((file) => {
    exportFile(auth, file.fileId, file.mimeType, file.extension, file.fileName);
  });
}

// export file to a different mimeType
function exportFile(auth, fileId, mimeType, extension, fileName) {
  const service = google.drive('v3');
  const now = moment().format('YYYYMMDD-HHmmss');
  // need to create folder etc
  const dest = fs.createWriteStream(`${BACKUP_DIR}/${now}-${fileName}.${extension}`);

  // https://developers.google.com/drive/v3/web/manage-downloads
// works
  service.files.export({
    auth,
    mimeType,
    fileId
  })
  .on('end', () => {
    logger.info(`Done: ${now}-${fileName}.${extension}`);
  })
  .on('error', (err) => {
    logger.error('Error during download', err);
  })
  .pipe(dest);
}

const https = require('https');
const http = require('http');

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const TIMEOUT_MS = 15000;

function createGhlClient(config) {
  const baseUrl = config.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com';
  const token = config.GHL_PRIVATE_TOKEN;
  const locationId = config.GHL_LOCATION_ID;

  function request(method, path, body, attempt = 0) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const opts = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : undefined),
        path: url.pathname + url.search,
        headers,
        timeout: TIMEOUT_MS,
      };

      const req = mod.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 429 || res.statusCode >= 500) {
            if (attempt < MAX_RETRIES) {
              const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
              return setTimeout(() => {
                request(method, path, body, attempt + 1).then(resolve, reject);
              }, delay);
            }
          }
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              const err = new Error(`GHL API ${res.statusCode}: ${parsed.message || data.slice(0, 200)}`);
              err.statusCode = res.statusCode;
              err.body = parsed;
              return reject(err);
            }
            resolve(parsed);
          } catch (e) {
            resolve({ raw: data, statusCode: res.statusCode });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          return setTimeout(() => {
            request(method, path, body, attempt + 1).then(resolve, reject);
          }, delay);
        }
        reject(new Error('GHL API request timed out'));
      });

      req.on('error', (err) => {
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          return setTimeout(() => {
            request(method, path, body, attempt + 1).then(resolve, reject);
          }, delay);
        }
        reject(err);
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  return {
    getContactByEmail(email) {
      const q = encodeURIComponent(email.trim().toLowerCase());
      return request('GET', `/contacts/search/duplicate?locationId=${locationId}&email=${q}`);
    },

    getContact(contactId) {
      return request('GET', `/contacts/${contactId}`);
    },

    updateContact(contactId, data) {
      return request('PUT', `/contacts/${contactId}`, data);
    },

    createContact(data) {
      return request('POST', '/contacts/', { locationId, ...data });
    },

    searchContacts(query) {
      return request('POST', `/contacts/search`, {
        locationId,
        query,
        limit: 1,
      });
    },

    createNote(contactId, body) {
      return request('POST', `/contacts/${contactId}/notes`, { body, userId: locationId });
    },

    createTask(contactId, task) {
      return request('POST', `/contacts/${contactId}/tasks`, task);
    },

    listCustomFields() {
      return request('GET', `/locations/${locationId}/customFields`);
    },

    createCustomField(field) {
      return request('POST', `/locations/${locationId}/customFields`, field);
    },

    getCustomFieldFolders() {
      return request('GET', `/locations/${locationId}/customFields/folders`);
    },
  };
}

module.exports = { createGhlClient };

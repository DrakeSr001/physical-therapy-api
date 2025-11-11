// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: "https://8a67d9c7dcc9f5f52e305979271e6ee2@o4510347058085888.ingest.us.sentry.io/4510347058348032",
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  //
  sendDefaultPii: true,
});
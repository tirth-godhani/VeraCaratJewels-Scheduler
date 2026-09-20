export const logger = {
  info: (msg, ...args) => {
    console.log(`[${new Date().toISOString()}] [INFO]  ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.warn(`[${new Date().toISOString()}] [WARN]  ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, ...args);
  },
  success: (msg, ...args) => {
    console.log(`[${new Date().toISOString()}] [SUCCESS] \x1b[32m${msg}\x1b[0m`, ...args);
  },
  dryRun: (msg, ...args) => {
    console.log(`[${new Date().toISOString()}] [DRY-RUN] \x1b[33m${msg}\x1b[0m`, ...args);
  }
};

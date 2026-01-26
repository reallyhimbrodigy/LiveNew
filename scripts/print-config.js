import { getConfig } from "../src/server/config.js";

const config = getConfig();
const summary = {
  envMode: config.envMode,
  isDevLike: config.isDevLike,
  isAlphaLike: config.isAlphaLike,
  isProdLike: config.isProdLike,
  requireAuth: config.requireAuth,
  devRoutesEnabled: config.devRoutesEnabled,
  csrfEnabled: config.csrfEnabled,
  rateLimits: config.rateLimits,
  cacheTTLSeconds: config.cacheTTLSeconds,
  adminEmailsCount: config.adminEmails?.size || 0,
  port: config.port,
  dataDir: config.dataDir,
};

console.log(JSON.stringify({ config: summary }, null, 2));

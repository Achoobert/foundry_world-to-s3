/**
 * Copy to fvtt.config.js and fill in.
 *   npm run build  copies the module to {userDataPath}/Data/modules/world-to-s3
 *   npm run watch  same, on every save
 */
const developmentOptions = {
  userDataPath: "/Users/YOUR_USERNAME/foundrydata",
  baseURL: "http://localhost:30000",
  /** World Cypress launches for Quench. Needs Quench + world-to-s3 enabled. */
  testWorldName: "YOUR_TEST_WORLD",
  adminPassword: "",
};

export default developmentOptions;

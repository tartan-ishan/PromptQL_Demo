import { start } from "@hasura/ndc-duckduckapi";
import { makeConnector, duckduckapi } from "@hasura/ndc-duckduckapi";
import * as path from "path";
import { CsvDataSyncManager } from "./functions";

const connectorConfig: duckduckapi = {
  dbSchema: `
    SELECT 1;
    -- CSV Dataset Schema will be added dynamically
  `,
  functionsFilePath: path.resolve(__dirname, "./functions.ts"),
};

(async () => {
  try {
    const csvSyncManager = new CsvDataSyncManager();
    const isCsvConfigured = csvSyncManager.isConfigValid();

    if (!isCsvConfigured) {
      console.log("No valid CSV files. Exiting load");
      return;
    }
    // Load CSV data and get schema
    console.log('Initializing CSV dataset sync...');
    const csvManager = new CsvDataSyncManager();
    const csvSchema = await csvManager.sync();

    // Initialize connector with schema
    const connector = await makeConnector(connectorConfig);
    start(connector);
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
})();
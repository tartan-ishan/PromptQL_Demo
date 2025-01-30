import { getDB } from "@hasura/ndc-duckduckapi";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as stream from 'stream';
import { promisify } from 'util';
import * as dotenv from 'dotenv';

dotenv.config();

const pipeline = promisify(stream.pipeline);

export class CsvDataSyncManager {

  private readonly csvDirectory: string;

  constructor() {
    this.csvDirectory = path.join(process.cwd(), 'csv_files');
  }

  private generateTableName(filePath: string): string {
    return path.basename(filePath, '.csv')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
  }

  private async getCSVFilesFromDirectory(directory: string): Promise<string[]> {
    try {
      // Check if directory exists
      if (!fs.existsSync(directory)) {
        throw new Error(`Directory ${directory} does not exist`);
      }

      // Read all files in the directory
      const files = fs.readdirSync(directory);
      
      // Filter for CSV files and get their full paths
      const csvFiles = files
        .filter(file => file.toLowerCase().endsWith('.csv'))
        .map(file => path.join(directory, file));

      return csvFiles;
    } catch (error) {
      console.error('Error reading directory:', error);
      throw error;
    }
  }

  private async importCSV(filePath: string): Promise<string> {
    const db = await getDB();
    const tableName = this.generateTableName(filePath);
    
    // First drop the table if it exists
    try {
      await db.run(`DROP TABLE IF EXISTS ${tableName};`);
    } catch (error) {
      console.warn(`Warning: Failed to drop table ${tableName}:`, error);
    }

    console.log(`Creating table ${tableName} from ${path.basename(filePath)}...`);
    
    // Create table directly from CSV using DuckDB's read_csv
    await db.run(`
      CREATE TABLE ${tableName} AS 
      SELECT * 
      FROM read_csv('${filePath}', auto_detect=true, ignore_errors=true);
    `);

    // Get the created table schema
    const schemaResult = await db.all(`
      SELECT 
        column_name,
        data_type
      FROM information_schema.columns 
      WHERE table_name = '${tableName}'
      ORDER BY ordinal_position;
    `);

    // Generate CREATE TABLE statement for schema documentation
    const createTableStmt = `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ` +
      schemaResult.map(col => 
        `"${col.column_name}" ${col.data_type}`
      ).join(',\n  ') +
      '\n);\n\n';

    // Get row count
    const [{ count }] = await db.all(`SELECT COUNT(*) as count FROM ${tableName}`);
    console.log(`Imported ${count} rows into ${tableName}`);
    
    return createTableStmt;
  }

  public async sync(): Promise<string> {
    try {
      console.log('Loading CSV Data...');
      
      // Get CSV files from directory
      const csvFiles = await this.getCSVFilesFromDirectory(this.csvDirectory);
      
      if (csvFiles.length === 0) {
        throw new Error(`No CSV files found in directory: ${this.csvDirectory}`);
      }

      console.log(`Found ${csvFiles.length} CSV files to process`);

      // Import each CSV and collect schemas
      let schema = '';
      for (const csvFile of csvFiles) {
        console.log(`Processing ${path.basename(csvFile)}...`);
        try {
          schema += await this.importCSV(csvFile);
        } catch (error) {
          console.error(`Error importing ${path.basename(csvFile)}:`, error);
          // Continue with next file instead of failing completely
        }
      }

      return schema;
    } catch (error) {
      console.error('Failed to load csv dataset:', error);
      throw error;
    }
  }
  public isConfigValid(): boolean {
    return fs.existsSync(this.csvDirectory);
  }
}
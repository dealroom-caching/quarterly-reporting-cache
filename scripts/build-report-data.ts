import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

// Sheet configurations with GID (more reliable than names)
const SHEET_CONFIGS = [
  { key: 'locations', name: 'Locations Metadata', gid: '1263377552' },
  { key: 'yearly_funding', name: 'Yearly Funding Data', gid: '1426194263' },
  { key: 'quarterly_funding', name: 'Quarterly Funding Data', gid: '883461842' },
  { key: 'yearly_ev', name: 'Yearly Enterprise Value', gid: '1785838256' },
  { key: 'top_industries_tags', name: 'Top Industries and Tags', gid: '1075248480' },
  { key: 'top_rounds', name: 'Top Rounds', gid: '279039385' },
  { key: 'regional_comparison', name: 'Regional Comparison', gid: '1503787806' },
];

// Primary key column for filtering empty rows
const PRIMARY_KEY = 'location_database_name';

/**
 * Parse CSV text into array of objects
 */
function parseCSV(csvText: string): Record<string, string>[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    
    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        currentLine += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        currentLine += char;
      }
    } else if (char === '\n' && !inQuotes) {
      if (currentLine.trim()) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else if (char === '\r' && !inQuotes) {
      // Skip carriage returns
    } else {
      currentLine += char;
    }
  }
  
  if (currentLine.trim()) {
    lines.push(currentLine);
  }
  
  if (lines.length < 2) return [];
  
  const headers = parseCSVRow(lines[0]);
  
  const results: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    
    const obj: Record<string, string> = {};
    let rowHasData = false;
    
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j]?.trim();
      const value = values[j]?.trim() ?? '';
      
      if (header && value !== '') {
        obj[header] = value;
        rowHasData = true;
      }
    }
    
    if (rowHasData) {
      results.push(obj);
    }
  }
  
  return results;
}

function parseCSVRow(row: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    
    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  values.push(current);
  return values;
}

/**
 * Fetches sheet data using GID (more reliable) or falls back to sheet name
 */
async function fetchSheetData(config: typeof SHEET_CONFIGS[0]): Promise<Record<string, string>[]> {
  const cacheBuster = Date.now();
  
  // Use /export endpoint which returns all data regardless of filter state
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${config.gid}&_cb=${cacheBuster}`;
  
  console.log(`   Fetching ${config.name}...`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch "${config.name}": ${response.statusText}`);
  }
  
  const csvText = await response.text();
  const allRows = parseCSV(csvText);
  
  // Debug: show columns
  if (allRows.length > 0) {
    console.log(`   [${config.name}] Columns: ${Object.keys(allRows[0]).join(', ')}`);
  }
  
  // Filter: only keep rows where primary key has a value
  const filteredRows = allRows.filter(row => {
    const primaryValue = row[PRIMARY_KEY];
    return primaryValue && primaryValue.trim() !== '';
  });
  
  console.log(`   [${config.name}] Raw: ${allRows.length} -> Filtered: ${filteredRows.length} rows`);
  
  return filteredRows;
}

async function main() {
  if (!SHEET_ID) {
    console.error('❌ GOOGLE_SHEET_ID environment variable is not set');
    process.exit(1);
  }

  console.log('📥 Fetching Google Sheets data...');
  console.log(`   Sheet ID: ${SHEET_ID}`);
  console.log('');
  
  try {
    const sheetsData: Record<string, Record<string, string>[]> = {};
    
    for (const config of SHEET_CONFIGS) {
      try {
        sheetsData[config.key] = await fetchSheetData(config);
      } catch (error) {
        console.error(`   ❌ Failed to fetch ${config.name}:`, error);
        sheetsData[config.key] = [];
      }
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const quarterNumber = Math.ceil((now.getMonth() + 1) / 3) as 1|2|3|4;
    const reportingQuarter = `${year}Q${quarterNumber}`;
    
    const output = {
      meta: {
        generated_at: now.toISOString(),
        source_sheet_id: SHEET_ID,
        reporting_quarter: reportingQuarter,
        reporting_year: year,
        reporting_quarter_number: quarterNumber,
        schema_version: '2.0',
      },
      sheets: sheetsData,
      config: {
        map_enabled: false,
        share_preview_enabled: true,
        default_location_id: 'london',
      },
    };
    
    const publicDir = path.join(process.cwd(), 'public');
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir);
    }

    const outputPath = path.join(publicDir, 'report-data.json');
    writeFileSync(outputPath, JSON.stringify(output));
    
    console.log('');
    console.log('✅ Cache complete!');
    console.log(`   Reporting: ${reportingQuarter}`);
    
    let totalSize = 0;
    for (const config of SHEET_CONFIGS) {
      const data = sheetsData[config.key];
      const size = JSON.stringify(data).length;
      totalSize += size;
      console.log(`   ${config.name}: ${data.length} rows, ${(size / 1024).toFixed(1)} KB`);
    }
    
    const finalSize = JSON.stringify(output).length;
    console.log(`   Total size: ${(finalSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ Cache failed:', err);
    process.exit(1);
  }
}

main();

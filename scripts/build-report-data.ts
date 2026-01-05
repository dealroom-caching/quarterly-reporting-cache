import { writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAMES = [
  'Locations Metadata',
  'Yearly Funding Data',
  'Quarterly Funding Data',
  'Yearly Enterprise Value',
  'Top Industries, Tags, Rounds',
  'Top Rounds',
  'Regional Comparison',
];

// Primary key column for each sheet (used to filter empty rows)
// All sheets use location_database_name as the primary identifier
const PRIMARY_KEY_COLUMNS: Record<string, string> = {
  'Locations Metadata': 'location_database_name',
  'Yearly Funding Data': 'location_database_name',
  'Quarterly Funding Data': 'location_database_name',
  'Yearly Enterprise Value': 'location_database_name',
  'Top Industries, Tags, Rounds': 'location_database_name',
  'Top Rounds': 'location_database_name',
  'Regional Comparison': 'location_database_name',
};

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
 * Fetches sheet data using CSV export
 */
async function fetchSheetData(sheetName: string): Promise<Record<string, string>[]> {
  // Add cache-busting parameter to force fresh data
  const cacheBuster = Date.now();
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_cb=${cacheBuster}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet "${sheetName}": ${response.statusText}`);
  }
  
  const csvText = await response.text();
  const allRows = parseCSV(csvText);
  
  // Get the primary key column for this sheet
  const primaryKeyCol = PRIMARY_KEY_COLUMNS[sheetName];
  
  // Debug: show first row's keys
  if (allRows.length > 0) {
    console.log(`   [${sheetName}] Columns: ${Object.keys(allRows[0]).join(', ')}`);
  }
  
  // Filter: only keep rows where the primary key column has a value
  const filteredRows = allRows.filter(row => {
    const primaryValue = row[primaryKeyCol];
    return primaryValue && primaryValue.trim() !== '';
  });
  
  console.log(`   [${sheetName}] Raw: ${allRows.length} rows -> Filtered: ${filteredRows.length} rows`);
  
  return filteredRows;
}

async function main() {
  if (!SHEET_ID) {
    console.error('❌ GOOGLE_SHEET_ID environment variable is not set');
    process.exit(1);
  }

  console.log('📥 Fetching Google Sheets data...');
  
  try {
    const sheetsData = await Promise.all(
      SHEET_NAMES.map(name => fetchSheetData(name))
    );
    
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
      sheets: {
        locations: sheetsData[0],
        yearly_funding: sheetsData[1],
        quarterly_funding: sheetsData[2],
        yearly_ev: sheetsData[3],
        top_industries_tags: sheetsData[4],
        top_rounds: sheetsData[5],
        regional_comparison: sheetsData[6],
      },
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
    
    const sheetSizes = SHEET_NAMES.map((name, i) => ({
      name,
      rows: sheetsData[i].length,
      size: JSON.stringify(sheetsData[i]).length,
    }));
    sheetSizes.forEach(s => {
      console.log(`   ${s.name}: ${s.rows} rows, ${(s.size / 1024).toFixed(1)} KB`);
    });
    
    const totalSize = JSON.stringify(output).length;
    console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ Cache failed:', err);
    process.exit(1);
  }
}

main();

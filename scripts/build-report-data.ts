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

/**
 * Fetches sheet data using the Google Visualization API (JSON export path)
 * Optimized to exclude empty rows and columns.
 */
async function fetchSheetData(sheetName: string) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet "${sheetName}": ${response.statusText}`);
  }
  
  const text = await response.text();
  
  const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.*)\);/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse JSON response for sheet "${sheetName}"`);
  }
  
  const data = JSON.parse(jsonMatch[1]);
  const table = data.table;
  
  // 1. Identify valid columns (columns that have a header label)
  const validCols = table.cols
    .map((col: any, i: number) => ({ label: col.label?.trim(), index: i }))
    .filter((col: any) => col.label !== '');

  if (validCols.length === 0) return [];

  const results: any[] = [];

  // 2. Process rows and filter out empty ones
  for (const row of table.rows) {
    if (!row.c) continue;

    const obj: any = {};
    let hasData = false;

    for (const col of validCols) {
      const cell = row.c[col.index];
      const value = cell?.v ?? '';
      
      // Check if value is truly empty (ignoring empty strings)
      if (value !== '' && value !== null && value !== undefined) {
        hasData = true;
      }
      obj[col.label] = value;
    }

    // Only add row if it contains at least one non-empty cell in a valid column
    if (hasData) {
      results.push(obj);
    }
  }
  
  return results;
}

async function main() {
  if (!SHEET_ID) {
    console.error('❌ GOOGLE_SHEET_ID environment variable is not set');
    process.exit(1);
  }

  console.log('📥 Fetching Google Sheets data (Optimized)...');
  
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
    // Removed indentation to minimize file size
    writeFileSync(outputPath, JSON.stringify(output));
    
    console.log('✅ Cache complete!');
    console.log(`   Locations: ${sheetsData[0].length}`);
    console.log(`   Reporting: ${reportingQuarter}`);
    console.log(`   Size: ${(JSON.stringify(output).length / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ Cache failed:', err);
    process.exit(1);
  }
}

main();

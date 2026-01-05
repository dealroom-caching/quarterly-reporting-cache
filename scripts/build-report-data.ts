import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import path from 'path';

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAMES = [
  'Locations Metadata',
  'Yearly Funding Data',
  'Quarterly Funding Data',
  'Yearly Enterprise Value',
  'Top Industries and Tags',
  'Top Rounds',
  'Regional Comparison',
];

async function main() {
  console.log('📥 Fetching Google Sheets data...');
  
  // Setup Google Sheets API
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  
  // Fetch all sheets in parallel
  const responses = await Promise.all(
    SHEET_NAMES.map(name =>
      sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${name}'`,
      })
    )
  );
  
  // Convert each sheet to array of objects
  const sheetsData = responses.map((res, i) => {
    const rows = res.data.values || [];
    if (rows.length < 2) {
      console.warn(`⚠️  Sheet "${SHEET_NAMES[i]}" is empty`);
      return [];
    }
    
    const [headers, ...dataRows] = rows;
    return dataRows.map(row =>
      Object.fromEntries(
        headers.map((header, j) => [header, row[j] ?? ''])
      )
    );
  });
  
  // Calculate current reporting quarter
  const now = new Date();
  const year = now.getFullYear();
  const quarterNumber = Math.ceil((now.getMonth() + 1) / 3) as 1|2|3|4;
  const reportingQuarter = `${year}Q${quarterNumber}`;
  
  // Build output JSON
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
  
  // Write to public/report-data.json
  const outputPath = path.join(process.cwd(), 'public', 'report-data.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log('✅ Cache complete!');
  console.log(`   Locations: ${sheetsData[0].length}`);
  console.log(`   Reporting: ${reportingQuarter}`);
  console.log(`   Size: ${(JSON.stringify(output).length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error('❌ Cache failed:', err);
  process.exit(1);
});


# Quarterly Report Data Pipeline

**Data Cache Specification (v2.0 - Simplified)**  
*Last updated: 2026-01-05*

This document specifies the **data caching pipeline** that fetches Google Sheets data and stores it as a JSON file consumed by the Quarterly Ecosystem Reporter webapp. This pipeline runs in a **separate GitHub repository** from the webapp.

> **Philosophy:** This is a **dumb cache**. All business logic (filtering, projections, aggregations) happens in the webapp. The pipeline just fetches and stores raw sheet data.

> **Related:** See `quarterly-ecosystem-reporter-spec-revised.md` for the webapp specification.

---

## Table of contents

1. [Overview](#overview)
2. [Repository structure](#repository-structure)
3. [Google Sheets source](#google-sheets-source)
4. [Output JSON schema](#output-json-schema)
5. [GitHub Action workflow](#github-action-workflow)
6. [Build script implementation](#build-script-implementation)
7. [Repository setup](#repository-setup)

---

## Overview

### Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  Google Sheets  │ ───► │  GitHub Action (CI)  │ ───► │  Static JSON    │
│  (source data)  │      │  (fetch & cache)     │      │  (GitHub raw)   │
└─────────────────┘      └──────────────────────┘      └─────────────────┘
                                                              │
                                                              ▼
                                                       ┌─────────────────┐
                                                       │  Webapp (fetch) │
                                                       │  (processes)    │
                                                       └─────────────────┘
```

### Why a separate repository?

1. **Decoupled release cycles** — Update data without redeploying the app
2. **Simpler permissions** — Data team can push to data repo; webapp repo stays protected
3. **Cleaner git history** — Large JSON commits don't pollute the webapp history
4. **CDN-friendly** — GitHub raw URLs with cache-busting via commit SHA

---

## Repository structure

```
quarterly-report-data/
├── public/
│   └── report-data.json        # Single cached JSON (~2-5 MB, gzipped: ~300-600 KB)
├── scripts/
│   └── build-report-data.ts    # Simple fetch & cache script
├── .github/
│   └── workflows/
│       └── build-data.yml      # GitHub Action workflow
├── package.json
├── tsconfig.json
└── README.md
```

---

## Google Sheets source

**Google Sheets URL:**  
https://docs.google.com/spreadsheets/d/120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04/edit

**Sheet ID:** `120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04`

### 7 Sheets to fetch:

1. **Locations Metadata** — Location info, coordinates, descriptions
2. **Yearly Funding Data** — Annual VC funding totals
3. **Quarterly Funding Data** — Quarterly VC funding by stage category
4. **Yearly Enterprise Value** — Annual enterprise value totals
5. **Top Industries and Tags** — Top industries and tags by location
6. **Top Rounds** — Top funding rounds by location
7. **Regional Comparison** — Regional rankings

> **See existing types:** All sheet column schemas are already defined in `src/lib/data/types.ts` in the webapp (e.g., `RawLocationRow`, `RawYearlyFundingRow`, etc.)

---

## Output JSON schema

### `report-data.json`

Single file containing all cached sheet data as arrays of objects:

```typescript
interface ReportData {
  meta: {
    generated_at: string;              // ISO timestamp
    source_sheet_id: string;           // Google Sheet ID
    reporting_quarter: string;         // e.g. "2025Q3"
    reporting_year: number;            // e.g. 2025
    reporting_quarter_number: 1|2|3|4; // e.g. 3
    schema_version: string;            // "2.0"
  };

  // Raw sheet data - no transformations
  // Column names match Google Sheets exactly
  sheets: {
    locations: RawLocationRow[];              // Sheet 1
    yearly_funding: RawYearlyFundingRow[];    // Sheet 2
    quarterly_funding: RawQuarterlyFundingRow[]; // Sheet 3
    yearly_ev: RawYearlyEvRow[];              // Sheet 4
    top_industries_tags: RawTopIndustriesTagsRow[]; // Sheet 5
    top_rounds: RawTopRoundsRow[];            // Sheet 6
    regional_comparison: RawRegionalComparisonRow[]; // Sheet 7
  };

  // Simple config (can be set manually or from env)
  config: {
    map_enabled: boolean;
    share_preview_enabled: boolean;
    default_location_id: string;
  };
}
```

> **Note:** All `Raw*Row` types are already defined in the webapp at `src/lib/data/types.ts`

**Example structure:**
```json
{
  "meta": {
    "generated_at": "2025-01-05T12:00:00.000Z",
    "source_sheet_id": "120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04",
    "reporting_quarter": "2025Q3",
    "reporting_year": 2025,
    "reporting_quarter_number": 3,
    "schema_version": "2.0"
  },
  "sheets": {
    "locations": [
      {
        "location_database_name": "london",
        "location_display_name": "London",
        "display_location_type": "Metro",
        "location_type": "City",
        "lat": 51.5074,
        "long": -0.1278,
        "description": "London is Europe's leading tech hub...",
        "flag_code": "GB",
        "country_parent": ""
      }
    ],
    "yearly_funding": [...],
    "quarterly_funding": [...],
    "yearly_ev": [...],
    "top_industries_tags": [...],
    "top_rounds": [...],
    "regional_comparison": [...]
  },
  "config": {
    "map_enabled": false,
    "share_preview_enabled": true,
    "default_location_id": "london"
  }
}
```

**What's NOT included (webapp handles these):**
- ❌ Quarter parsing/filtering
- ❌ Stage aggregations  
- ❌ Annual projections
- ❌ Comparison list building
- ❌ Region key normalization

---

## GitHub Action workflow

### `.github/workflows/build-data.yml`

```yaml
name: Cache Google Sheets Data

on:
  workflow_dispatch:  # Manual trigger
  schedule:
    - cron: '0 6 * * *'  # Daily at 6 AM UTC
  push:
    branches: [main]
    paths:
      - 'scripts/**'
      - '.github/workflows/build-data.yml'

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Fetch and cache Google Sheets data
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
        run: |
          echo "$GOOGLE_APPLICATION_CREDENTIALS" | base64 -d > /tmp/service-account.json
          GOOGLE_APPLICATION_CREDENTIALS=/tmp/service-account.json npx tsx scripts/build-report-data.ts

      - name: Validate JSON
        run: |
          test -s public/report-data.json || exit 1
          jq empty public/report-data.json
          echo "Size: $(wc -c < public/report-data.json) bytes"

      - name: Commit if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/report-data.json
          git diff --staged --quiet || git commit -m "chore: update cached data [skip ci]"
          git push
```

---

## Build script implementation

### `scripts/build-report-data.ts`

Simple script that fetches all 7 sheets and caches them as JSON:

```typescript
import { google } from 'googleapis';
import { writeFileSync } from 'fs';
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
  writeFileSync(outputPath, JSON.stringify(output));
  
  console.log('✅ Cache complete!');
  console.log(`   Locations: ${sheetsData[0].length}`);
  console.log(`   Reporting: ${reportingQuarter}`);
  console.log(`   Size: ${(JSON.stringify(output).length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error('❌ Cache failed:', err);
  process.exit(1);
});
```

**That's it!** ~70 lines instead of 500+. No transformations, no complex business logic.

---

## Repository setup

### `package.json`

```json
{
  "name": "quarterly-report-data",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx scripts/build-report-data.ts"
  },
  "dependencies": {
    "googleapis": "^130.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["scripts/**/*"]
}
```

### GitHub repository secrets

1. **Create a Google Cloud service account:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Enable the Google Sheets API
   - Create a service account with "Viewer" role
   - Download the JSON key file

2. **Share the Google Sheet:**
   - Open https://docs.google.com/spreadsheets/d/120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04/edit
   - Share with the service account email (from JSON key)
   - Grant "Viewer" access

3. **Add secrets to GitHub:**
   - Go to repo → Settings → Secrets and variables → Actions
   - Add `GOOGLE_SERVICE_ACCOUNT_KEY`: Base64-encoded JSON key
     ```bash
     base64 -i service-account.json | pbcopy
     ```
   - Add `GOOGLE_SHEET_ID`: `120IXe10QWLsOjMwK1beu2pY-jlSLQjaO-kfc10q9J04`

---

## Usage

### Webapp integration

The webapp fetches the cached JSON from GitHub raw URL:

```typescript
// src/lib/data/use-report-data.ts
const DATA_URL = 'https://raw.githubusercontent.com/your-org/quarterly-report-data/main/public/report-data.json';

export async function fetchReportData() {
  const response = await fetch(DATA_URL);
  return await response.json();
}
```

### Local development

Use the mock data already in `/public/data/report-data.json` in the webapp repo for development.

---

## Summary

**What changed from v1.0:**
- ❌ Removed complex transformations (quarter parsing, stage aggregations, projections)
- ❌ Removed pre-computed comparison lists
- ❌ Removed region key normalization
- ❌ Removed separate config file
- ✅ Single simple cache file
- ✅ ~70 line build script (was 500+)
- ✅ All business logic moved to webapp where it belongs

**The pipeline is now truly a "dumb cache" — fetch sheets, store JSON, done.**


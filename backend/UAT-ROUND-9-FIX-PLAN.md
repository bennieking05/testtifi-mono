# UAT Round 9 - Fix Plan

## Summary of Issues

### ✅ Working Correctly (No Action Needed)
1. **Credits updating after purchase** - Webhook integration working
2. **Email notification prompt** - Appears as expected
3. **Cover page with logo** - Displaying correctly

### ⚠️ Needs Investigation
4. **Upload failure** - Sackler transcript didn't upload

### 🔧 Fixes Required

## Priority 1: CRITICAL - AI Output Issues

### Issue: Q&A Format Instead of Narrative
**Problem:** AI is generating Q: and A: format instead of narrative summaries
**Impact:** Makes summary unprofessional and hard to read
**Fix Location:** `/backend/config/summaryPrompt.json`

**Action:**
```
1. Update system prompt to EXPLICITLY prohibit Q&A format
2. Add examples showing narrative style only
3. Add instruction: "NEVER use Q: or A: labels. Convert all testimony to narrative prose."
4. Test with sample transcript to verify narrative output
```

### Issue: 1:1 Page Compression (97 pages instead of 20-30)
**Problem:** AI summarizing 1 page at a time instead of grouping 4+ pages
**Impact:** Summary is 3x too long and defeats purpose of summarization
**Fix Location:** `/backend/config/summaryPrompt.json`

**Action:**
```
1. Update COMPRESSION & SEGMENTATION section
2. Change from "every 10-15 lines" to "group 3-5 transcript pages per summary row"
3. Add explicit instruction: "Aim for 4:1 compression (4 transcript pages = 1 summary page)"
4. Add instruction: "Consolidate related testimony across multiple pages into single summary rows"
5. Test to ensure 330 page transcript → ~30 page summary
```

## Priority 2: HIGH - Metadata Issues

### Issue: "Unknown" Deponent Name
**Problem:** Deponent field not being used in preview/downloads
**Impact:** Unprofessional output, missing key information
**Fix Locations:** 
- `/backend/src/routes/previewRoutes.ts`
- `/backend/src/routes/downloadRoutes.ts`

**Action:**
```
1. Verify deponent is stored in File.deponent field (already captured from upload form)
2. Update previewRoutes.ts to read and display deponent from database
3. Update all download formats (PDF, DOCX, TXT) to include deponent
4. Add fallback to "Not Specified" instead of "Unknown"
```

### Issue: "Unknown" Case Number and Deposition Date
**Problem:** Not extracting metadata from transcript
**Impact:** Incomplete cover page
**Fix Location:** `/backend/src/worker/summarizeWorker.ts` or new metadata extraction

**Action:**
```
1. Add metadata extraction step to worker before summarization
2. Use AI or regex to extract:
   - Case name/number (usually in first 1-2 pages)
   - Deposition date (usually in first 1-2 pages)
   - Attorney names
3. Store in File table
4. Display in preview/downloads
5. If not found, show "Not Specified" instead of "Unknown"
```

## Priority 3: HIGH - Remove NOTE Section

### Issue: Instructional NOTE Appearing in Output
**Problem:** Internal instructions showing to end users
**Impact:** Unprofessional, confusing
**Fix Locations:**
- `/backend/src/routes/previewRoutes.ts`
- `/backend/src/routes/downloadRoutes.ts`

**Action:**
```
1. Update preview HTML generation to skip NOTE section
2. Update PDF generation to filter out NOTE
3. Update DOCX generation to filter out NOTE
4. Update TXT generation to filter out NOTE
5. Filter any line starting with "NOTE:" or "CRITICAL:" from AI output
```

## Priority 4: MEDIUM - UI Improvements

### Issue: Remove "Pages" Column
**Problem:** Redundant with "Total Pages" and "Last Page"
**Impact:** UI clutter
**Fix Location:** `/loveable/src/pages/Summaries.tsx` or table component

**Action:**
```
1. Find summaries table component
2. Remove "Pages" column from table headers and data
3. Keep "Total Pages" and "Last Page" columns
4. Test to ensure table renders correctly
```

### Issue: Purchase History Shows Manual Credits
**Problem:** 25 manually granted credits showing as "purchase"
**Impact:** Confusing billing history
**Fix Location:** `/loveable/src/pages/Account.tsx` or `/backend/src/routes/purchaseRoutes.ts`

**Action:**
```
1. Update purchase history API to only return records with stripePaymentIntentId
2. Filter out LedgerEntry records that don't have associated Purchase
3. Ensure manual credits still count toward balance but don't show in "purchase" history
4. Consider adding "Credits History" tab to show ALL credit changes
```

## Priority 5: MEDIUM - Upload Issue Investigation

### Issue: Sackler Transcript Upload Failed
**Problem:** File stated "uploading" but never completed
**Impact:** User couldn't process summary
**Investigation Steps:**
```
1. Check backend logs for upload errors around timestamp
2. Check file size - may have exceeded limit
3. Check network timeout settings
4. Add upload progress indicator to frontend
5. Add better error messages for upload failures
6. Consider chunked upload for large files
```

## Priority 6: LOW - PDF Issues

### Issue: PDF Shows 1,135 Pages
**Problem:** Page count calculation error
**Impact:** Misleading page count
**Fix Location:** `/backend/src/routes/downloadRoutes.ts` (PDF generation)

**Action:**
```
1. Review PDF generation logic
2. Fix page count calculation (may be counting characters instead of pages)
3. Test with various summary lengths
```

### Issue: "Jumbled" Title Page
**Problem:** PDF title page formatting issues
**Impact:** Unprofessional appearance
**Fix Location:** `/backend/src/routes/downloadRoutes.ts` (PDF cover page)

**Action:**
```
1. Review pdfkit layout code for cover page
2. Fix text positioning/spacing
3. Ensure proper line breaks
4. Test PDF output
```

---

## Implementation Order

1. **Fix AI Prompt** (Priority 1) - Most critical, affects all outputs
2. **Fix Metadata** (Priority 2) - Quick win, big impact
3. **Remove NOTE** (Priority 3) - Quick fix, improves professionalism
4. **UI Updates** (Priority 4) - User experience improvements
5. **Upload Investigation** (Priority 5) - May be user error or edge case
6. **PDF Fixes** (Priority 6) - Can wait until after main issues resolved

## Testing Checklist

After fixes:
- [ ] Upload 330+ page transcript
- [ ] Verify deponent name appears
- [ ] Verify narrative format (no Q&A)
- [ ] Verify ~4:1 compression (330 pages → ~80 summary pages max)
- [ ] Verify no NOTE section in any format
- [ ] Preview shows all metadata
- [ ] PDF downloads correctly formatted
- [ ] DOCX downloads correctly formatted
- [ ] TXT downloads correctly formatted
- [ ] Purchase history only shows Stripe purchases
- [ ] UI table shows correct columns


















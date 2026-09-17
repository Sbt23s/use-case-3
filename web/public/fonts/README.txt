NotoSansTamil-Regular.ttf
-------------------------
Noto Sans Tamil, from the Google Fonts project.
Licensed under the SIL Open Font License, Version 1.1.
https://github.com/google/fonts/tree/main/ofl/notosanstamil

Used by the PDF report generator (src/lib/report.ts) so that a Tamil report
renders Tamil script. jsPDF's built-in fonts are Latin-1 only and would draw
Tamil as blank boxes.

The file is fetched at download time, not bundled, so an English-only
deployment never pays for it. If it is removed, reports still generate: Tamil
is transliterated into Latin and the report says so on its face.

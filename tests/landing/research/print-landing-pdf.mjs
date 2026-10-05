// Prints the Spanish landing to an A4 PDF, to see the comparison (IV) on paper:
// every column should be there, nothing pinned or scrolled away.
//   SITE_URL=http://localhost:8793 node tests/landing/research/print-landing-pdf.mjs
//   pdftotext -layout /tmp/versorium-landing/vs-shots/landing-es.pdf - | grep -A12 "Las cartas"
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
await mkdir("/tmp/versorium-landing/vs-shots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
await page.pdf({ path: "/tmp/versorium-landing/vs-shots/landing-es.pdf", format: "A4", printBackground: true });
await browser.close();
console.log("pdf written to /tmp/versorium-landing/vs-shots/landing-es.pdf");

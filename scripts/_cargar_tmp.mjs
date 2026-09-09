
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
const p = await b.newPage(); p.setDefaultTimeout(120000);
await p.goto("https://prestaya.uy/ingresar", { waitUntil: "domcontentloaded" });
await p.fill('input[type="email"]', "carlos@prestaya.uy");
await p.fill('input[type="password"]', "PrestaYa2026!");
await p.click('button[type="submit"]'); await p.waitForURL(/\/admin/, { timeout: 90000 });
const t = Date.now();
await p.goto("https://prestaya.uy" + process.argv[2], { waitUntil: "domcontentloaded" });
console.log("PANTALLA_MS=" + (Date.now() - t));
await b.close();

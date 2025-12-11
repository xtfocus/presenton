import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const groupName = searchParams.get("group");

  console.log(`[TEMPLATE API] Request received for group: ${groupName}`);

  if (!groupName) {
    console.error(`[TEMPLATE API] Missing group name`);
    return NextResponse.json({ error: "Missing group name" }, { status: 400 });
  }

  const schemaPageUrl = `http://localhost:3000/schema?group=${encodeURIComponent(
    groupName
  )}`;
  console.log(`[TEMPLATE API] Schema page URL: ${schemaPageUrl}`);

  let browser;
  try {
    console.log(`[TEMPLATE API] Launching Puppeteer browser...`);
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      timeout: 60000, // Increase launch timeout to 60 seconds
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",
        "--single-process", // Run in single process mode to reduce memory usage
        "--disable-extensions",
      ],
    });
    console.log(`[TEMPLATE API] Browser launched successfully`);
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.setDefaultNavigationTimeout(300000);
    page.setDefaultTimeout(300000);
    
    // Add console logging from page
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[TEMPLATE API] Page console [${type}]: ${text.substring(0, 200)}`);
    });
    
    // Add error logging from page
    page.on('pageerror', error => {
      console.error(`[TEMPLATE API] Page error: ${error.message}`);
    });
    
    console.log(`[TEMPLATE API] Navigating to schema page...`);
    await page.goto(schemaPageUrl, {
      waitUntil: "networkidle0",
      timeout: 300000,
    });
    const navTime = Date.now() - startTime;
    console.log(`[TEMPLATE API] Navigation completed after ${navTime}ms`);
    console.log(`[TEMPLATE API] Current URL: ${page.url()}`);

    // Check page content
    const pageContent = await page.evaluate(() => document.body.innerText);
    console.log(`[TEMPLATE API] Page content preview: ${pageContent.substring(0, 300)}`);

    console.log(`[TEMPLATE API] Waiting for [data-layouts] selector...`);
    try {
      await page.waitForSelector("[data-layouts]", { timeout: 300000 });
      console.log(`[TEMPLATE API] Found [data-layouts] selector`);
    } catch (e) {
      const pageContent = await page.evaluate(() => document.body.innerText);
      const pageHTML = await page.content();
      console.error(`[TEMPLATE API] Failed to find [data-layouts] selector after 300s`);
      console.error(`[TEMPLATE API] Page content: ${pageContent.substring(0, 1000)}`);
      console.error(`[TEMPLATE API] Page HTML snippet: ${pageHTML.substring(0, 2000)}`);
      throw e;
    }
    
    console.log(`[TEMPLATE API] Waiting for [data-settings] selector...`);
    try {
      await page.waitForSelector("[data-settings]", { timeout: 300000 });
      console.log(`[TEMPLATE API] Found [data-settings] selector`);
    } catch (e) {
      const pageContent = await page.evaluate(() => document.body.innerText);
      console.error(`[TEMPLATE API] Failed to find [data-settings] selector after 300s`);
      console.error(`[TEMPLATE API] Page content: ${pageContent.substring(0, 1000)}`);
      throw e;
    }

    const { dataLayouts, dataGroupSettings } = await page.$eval(
      "[data-layouts]",
      (el) => ({
        dataLayouts: el.getAttribute("data-layouts"),
        dataGroupSettings: el.getAttribute("data-settings"),
      })
    );
    console.log(`[TEMPLATE API] Extracted data - layouts length: ${dataLayouts?.length || 0}, settings: ${!!dataGroupSettings}`);

    let slides, groupSettings;
    try {
      slides = JSON.parse(dataLayouts || "[]");
      console.log(`[TEMPLATE API] Parsed ${slides.length} slides`);
    } catch (e) {
      console.error(`[TEMPLATE API] Failed to parse layouts JSON: ${e}`);
      slides = [];
    }
    try {
      groupSettings = JSON.parse(dataGroupSettings || "null");
      console.log(`[TEMPLATE API] Parsed group settings: ${JSON.stringify(groupSettings)}`);
    } catch (e) {
      console.error(`[TEMPLATE API] Failed to parse settings JSON: ${e}`);
      groupSettings = null;
    }

    const response = {
      name: groupName,
      ordered: groupSettings?.ordered ?? false,
      slides: slides.map((slide: any) => ({
        id: slide.id,
        name: slide.name,
        description: slide.description,
        json_schema: slide.json_schema,
      })),
    };

    const totalTime = Date.now() - startTime;
    console.log(`[TEMPLATE API] Successfully generated layout after ${totalTime}ms`);
    return NextResponse.json(response);
  } catch (err) {
    const totalTime = Date.now() - startTime;
    console.error(`[TEMPLATE API] Error after ${totalTime}ms:`, err);
    console.error(`[TEMPLATE API] Error type: ${err instanceof Error ? err.constructor.name : typeof err}`);
    console.error(`[TEMPLATE API] Error message: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(`[TEMPLATE API] Stack trace:`, err.stack);
    }
    return NextResponse.json(
      { 
        error: "Failed to fetch or parse client page",
        details: err instanceof Error ? err.message : String(err)
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      console.log(`[TEMPLATE API] Closing browser...`);
      await browser.close();
      console.log(`[TEMPLATE API] Browser closed`);
    }
  }
}

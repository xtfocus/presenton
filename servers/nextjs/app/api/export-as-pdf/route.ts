import path from "path";
import fs from "fs";
import puppeteer from "puppeteer";

import { sanitizeFilename } from "@/app/(presentation-generator)/utils/others";
import { NextResponse, NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  console.log("[EXPORT-PDF] Export PDF request received");
  const { id, title } = await req.json();
  console.log("[EXPORT-PDF] Presentation ID:", id, "Title:", title);
  if (!id) {
    console.error("[EXPORT-PDF] Missing presentation ID");
    return NextResponse.json(
      { error: "Missing Presentation ID" },
      { status: 400 }
    );
  }
  console.log("[EXPORT-PDF] Launching Puppeteer browser...");
  const browser = await puppeteer.launch({
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
  console.log("[EXPORT-PDF] Browser launched, creating new page...");
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.setDefaultNavigationTimeout(300000);
  page.setDefaultTimeout(300000);

  const pdfMakerUrl = `http://localhost:3000/pdf-maker?id=${id}`;
  console.log("[EXPORT-PDF] Navigating to:", pdfMakerUrl);
  
  // Wait a moment to ensure Next.js server is ready
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Puppeteer runs in the same container as Next.js, so use localhost:3000
  try {
    console.log("[EXPORT-PDF] Starting navigation...");
    await page.goto(pdfMakerUrl, {
      waitUntil: "load",  // Changed from domcontentloaded to load
      timeout: 60000,  // Reduced timeout to 60 seconds initially
    });
    console.log("[EXPORT-PDF] Navigation completed successfully");
  } catch (error) {
    console.error("[EXPORT-PDF] Navigation failed:", error);
    // Try one more time with a longer timeout
    console.log("[EXPORT-PDF] Retrying navigation with longer timeout...");
    try {
      await page.goto(pdfMakerUrl, {
        waitUntil: "load",
        timeout: 120000,
      });
      console.log("[EXPORT-PDF] Retry navigation succeeded");
    } catch (retryError) {
      console.error("[EXPORT-PDF] Retry navigation also failed:", retryError);
      throw retryError;
    }
  }
  
  const currentUrl = page.url();
  console.log("[EXPORT-PDF] Navigated to pdf-maker, current URL:", currentUrl);
  
  if (currentUrl.includes('/') && !currentUrl.includes('/pdf-maker')) {
    const pageContent = await page.evaluate(() => document.body.innerText);
    console.error("[EXPORT-PDF] Redirected away from pdf-maker. Current URL:", currentUrl);
    console.error("[EXPORT-PDF] Page content preview:", pageContent.substring(0, 500));
    throw new Error(`Page was redirected to ${currentUrl}. Likely missing configuration.`);
  }
  
  // Wait a bit for React to hydrate and start fetching
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log("[EXPORT-PDF] Waiting for presentation slides to load...");
  
  // Wait for the presentation slides wrapper to appear
  try {
    // First check if there's an error state
    const errorElement = await page.$('div[role="alert"]');
    if (errorElement) {
      const errorText = await page.evaluate(el => el.textContent, errorElement);
      throw new Error(`Page shows error state: ${errorText}`);
    }
    
    // Wait for the slides wrapper element to exist
    await page.waitForSelector('#presentation-slides-wrapper', {
      timeout: 60000,
      visible: true
    });
    console.log("[EXPORT-PDF] Slides wrapper found");
    
    // Wait for slides to actually render (check for child elements, not skeletons)
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('#presentation-slides-wrapper');
        if (!wrapper) return false;
        // Check if there are slide elements (not just skeletons with bg-gray-400)
        const slides = wrapper.querySelectorAll(':scope > div > div');
        const hasSkeletons = wrapper.querySelectorAll('.bg-gray-400').length > 0;
        return slides.length > 0 && !hasSkeletons;
      },
      { timeout: 60000 }
    );
    console.log("[EXPORT-PDF] Slides rendered");
    
    // Additional wait to ensure React has finished rendering
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    // Log page content for debugging
    const bodyText = await page.evaluate(() => document.body.innerText);
    const htmlContent = await page.content();
    console.error('[EXPORT-PDF] Failed to find slides. Page content:', bodyText.substring(0, 1000));
    console.error('[EXPORT-PDF] Page HTML snippet:', htmlContent.substring(0, 2000));
    throw new Error(`Presentation slides not found: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log("[EXPORT-PDF] Generating PDF...");
  const pdfBuffer = await page.pdf({
    width: "1280px",
    height: "720px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  console.log("[EXPORT-PDF] PDF generated, size:", pdfBuffer.length, "bytes");

  browser.close();
  console.log("[EXPORT-PDF] Browser closed");

  const sanitizedTitle = sanitizeFilename(title ?? "presentation");
  const appDataDirectory = process.env.APP_DATA_DIRECTORY!;
  if (!appDataDirectory) {
    return NextResponse.json({
      error: "App data directory not found",
      status: 500,
    });
  }
  const destinationPath = path.join(
    appDataDirectory,
    "exports",
    `${sanitizedTitle}.pdf`
  );
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.writeFile(destinationPath, pdfBuffer);

  return NextResponse.json({
    success: true,
    path: destinationPath,
  });
}

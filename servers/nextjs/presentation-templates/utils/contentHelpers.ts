/**
 * Helper function to get content value with fallback, preserving empty strings
 * 
 * When content is an empty string, we want to preserve it (not use fallback)
 * This ensures deleted content stays deleted and doesn't show placeholder text
 * 
 * @param value - The content value from slideData
 * @param fallback - The fallback value to use if value is undefined/null
 * @returns The value if it exists (even if empty string), otherwise the fallback
 */
export function getContentWithFallback(value: string | undefined | null, fallback: string): string {
  // If value is explicitly undefined or null, use fallback
  // If value is an empty string, preserve it (don't use fallback)
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}



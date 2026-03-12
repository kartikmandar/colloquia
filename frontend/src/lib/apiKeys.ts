const GEMINI_KEY = "colloquia_gemini_key";

export function getGeminiKey(): string | null {
  return localStorage.getItem(GEMINI_KEY);
}

export function setGeminiKey(key: string): void {
  localStorage.setItem(GEMINI_KEY, key);
}

export function clearAllKeys(): void {
  localStorage.removeItem(GEMINI_KEY);
}

export function hasGeminiKey(): boolean {
  const key: string | null = getGeminiKey();
  return key !== null && key.length > 0;
}

const GEMINI_KEY = "colloquia_gemini_key";
const S2_KEY = "colloquia_s2_key";

export function getGeminiKey(): string | null {
  return localStorage.getItem(GEMINI_KEY);
}

export function setGeminiKey(key: string): void {
  localStorage.setItem(GEMINI_KEY, key);
}

export function getS2Key(): string | null {
  return localStorage.getItem(S2_KEY);
}

export function setS2Key(key: string): void {
  localStorage.setItem(S2_KEY, key);
}

export function clearAllKeys(): void {
  localStorage.removeItem(GEMINI_KEY);
  localStorage.removeItem(S2_KEY);
}

export function hasGeminiKey(): boolean {
  const key: string | null = getGeminiKey();
  return key !== null && key.length > 0;
}

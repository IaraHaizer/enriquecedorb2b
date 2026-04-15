export function getCompanyLogo(domain?: string): string | null {
  if (!domain) return null;
  // Clean the domain (remove http://, www., paths, etc.)
  let cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];
  cleanDomain = cleanDomain.replace(/^www\./, "");
  
  if (!cleanDomain || cleanDomain.length < 4 || !cleanDomain.includes(".")) return null;

  // Use Clearbit as the primary source (high quality)
  // Fallback could be implemented later if Clearbit fails, but for now we rely on <img> onerror in the component.
  return `https://logo.clearbit.com/${cleanDomain}`;
}

export function getFallbackLogo(domain?: string): string | null {
  if (!domain) return null;
  let cleanDomain = domain.replace(/^https?:\/\//, "").split("/")[0];
  cleanDomain = cleanDomain.replace(/^www\./, "");
  
  if (!cleanDomain || cleanDomain.length < 4 || !cleanDomain.includes(".")) return null;
  
  // Google S2 Favicon as fallback
  return `https://s2.googleusercontent.com/s2/favicons?domain=${cleanDomain}&sz=128`;
}

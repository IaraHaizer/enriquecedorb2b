
function extractSocialLinksFromMarkdown(markdown) {
  if (!markdown) return [];
  const socialPatterns = [
    /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:user|channel|c)\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?twitter\.com\/[a-zA-Z0-9._-]+/gi,
    /https?:\/\/(?:www\.)?x\.com\/[a-zA-Z0-9._-]+/gi,
  ];

  const links = new Set();
  for (const pattern of socialPatterns) {
    const matches = markdown.match(pattern);
    if (matches) {
      matches.forEach(link => {
        const clean = link.replace(/[.,;]$/, "").split(/[?#]/)[0];
        if (!clean.match(/login|share|privacy|terms|policies/i)) {
          links.add(clean);
        }
      });
    }
  }
  return [...links];
}

const testMd = `
Visite nosso Facebook em https://www.facebook.com/empresa.oficial e nosso Instagram
em https://instagram.com/empresa_bh. Também estamos no LinkedIn: https://www.linkedin.com/company/empresa-ltda?ref=xyz.
Não pegue links de login: https://facebook.com/login.php.
Twitter antigo: https://twitter.com/empresa_x. Novo X: https://x.com/empresa_x.
`;

console.log(extractSocialLinksFromMarkdown(testMd));

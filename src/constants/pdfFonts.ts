const notoSansScFontModules = import.meta.glob('../assets/fonts/NotoSansSC-*.ttf', {
  query: '?inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const pickPreferredNotoSansSc = (modules: Record<string, string>) => {
  const entries = Object.entries(modules);
  if (!entries.length) return '';

  const exactRegular = entries.find(([path]) => path.endsWith('NotoSansSC-Regular.ttf'));
  if (exactRegular) return exactRegular[1];

  const fallbackLight = entries.find(([path]) => path.endsWith('NotoSansSC-Light.ttf'));
  if (fallbackLight) return fallbackLight[1];

  return entries[0][1];
};

const notoSansScDataUrl = pickPreferredNotoSansSc(notoSansScFontModules);

// Vite ?inline returns a data URL (data:...;base64,xxxx), jsPDF needs pure base64 body.
export const NOTO_SANS_SC_REGULAR_BASE64 = notoSansScDataUrl.startsWith('data:')
  ? (notoSansScDataUrl.split(',')[1] || '')
  : '';

export function splitProductAdCaption(text: string, maximum = 44) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (const word of words) {
    const current = chunks.at(-1);
    if (!current || `${current} ${word}`.length > maximum) chunks.push(word);
    else chunks[chunks.length - 1] = `${current} ${word}`;
  }
  return chunks.length ? chunks : [text];
}

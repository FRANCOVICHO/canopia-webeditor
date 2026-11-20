/* Defense in depth for recognisable regulated goods. This is NOT age verification.
   A per-SKU legal classification and an audited age/registration service are needed
   before any of these goods can be enabled. There is deliberately no client override. */
export function requiresLegalReview(product) {
  const items=Array.isArray(product.items)?product.items.map(item=>typeof item==='string'?item:item?.name||'').join(' '):'';
  const text = `${product.name || ''} ${product.category || ''} ${product.tag || ''} ${items}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /\b(tabaco|tobacco|nicotina|nicotine|cigarrillos?|cigarros?|cigars?|vapers?|vapes?|vapos?|vaporizador(?:es)?|e[- ]?liquids?|liquidos? para vapear|semillas? de cannabis|cannabis|marihuana|thc|cbd)\b/.test(text);
}

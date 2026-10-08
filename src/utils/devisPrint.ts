/**
 * Phase 1 — Minimal self-contained A4 print document for the Devis.
 *
 * This deliberately does NOT reuse `document.head.innerHTML` or the site
 * stylesheet: the print window receives its own small embedded CSS so that
 * ONLY the Devis content is printed — no site navbar, header, footer,
 * "Mon Compte", URL or any other page chrome can leak in. It provides:
 *   - `@page { size: A4; ... }` for exact paper sizing,
 *   - repeating table header + row page-break protection (pagination),
 *   - identical numbers to the on-screen document (totals are passed in —
 *     nothing is recalculated here).
 */
import type { DevisDocument } from '../types';

export interface DevisPrintTotals {
  subtotalMaterials: number;
  subtotalLabor: number;
  discount: number;
  netHt: number;
  tvaPercent: number;
  tvaAmount: number;
  timbreAmount: number;
  totalTtc: number;
  retenueAmount: number;
  netAPayer: number;
}

/**
 * The Devis passed to the print builder: the core client document plus the
 * optional runtime fields the on-screen document renders (company identity is
 * resolved client-side; server numeric reference; document type; validity).
 */
export type DevisForPrint = DevisDocument & {
  companyName?: string;
  companyPhone?: string;
  companyMatricule?: string;
  companyAddress?: string;
  devisNumber?: string;
  type?: string;
  validityDays?: number;
};

export interface DevisPrintInput {
  devis: DevisForPrint;
  dir?: 'rtl' | 'ltr';
  currencySymbol: string;
  decimals: number;
  countryName: string;
  buildingCodes: string;
  timbreLabel: string;
  includeTimbre: boolean;
  retenueGarantiePercent: number;
  totals: DevisPrintTotals;
}

const PRINT_CSS = `
  @page { size: A4 portrait; margin: 12mm 11mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #ffffff; color: #111827; font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.45; }
  .block { page-break-inside: avoid; break-inside: avoid; }
  .doc-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-badge { width: 30px; height: 30px; border: 1.6px solid #111827; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; }
  .brand-name { font-size: 17px; font-weight: 800; font-family: "Consolas", "Courier New", monospace; }
  .company-lines { margin-top: 6px; color: #374151; }
  .company-lines div { margin-top: 2px; }
  .doc-meta { min-width: 235px; border: 1px solid #9ca3af; border-radius: 8px; padding: 10px 12px; }
  .doc-meta .row { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
  .doc-meta .label { color: #4b5563; font-weight: 700; }
  .doc-meta .value { font-family: "Consolas", "Courier New", monospace; font-weight: 700; text-align: right; }
  .doc-type { color: #92400e; text-transform: uppercase; }
  .parties { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
  .party-box { flex: 1 1 260px; border: 1px solid #9ca3af; border-radius: 8px; padding: 10px 12px; }
  .party-box h4 { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #111827; margin-bottom: 6px; }
  .muted { color: #4b5563; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.items th { background: #f3f4f6; border: 1px solid #9ca3af; padding: 6px 7px; text-align: left; font-size: 10px; }
  table.items td { border: 1px solid #9ca3af; padding: 6px 7px; vertical-align: top; }
  table.items thead { display: table-header-group; }
  table.items tr { page-break-inside: avoid; break-inside: avoid; }
  .center { text-align: center; }
  .right { text-align: right; }
  .mono { font-family: "Consolas", "Courier New", monospace; }
  .strong { font-weight: 700; }
  .totals { border: 1px solid #9ca3af; border-radius: 8px; padding: 10px 12px; page-break-inside: avoid; break-inside: avoid; margin-left: auto; width: 330px; max-width: 100%; }
  .totals .row { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .totals .grand { border-top: 1.5px solid #111827; margin-top: 4px; padding-top: 5px; font-weight: 800; font-size: 13px; color: #92400e; }
  .notes { margin-top: 12px; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 11px; color: #374151; page-break-inside: avoid; break-inside: avoid; white-space: pre-wrap; }
  .signatures { display: flex; gap: 20px; margin-top: 24px; page-break-inside: avoid; break-inside: avoid; }
  .signature { flex: 1; border: 1px solid #9ca3af; border-radius: 8px; min-height: 95px; padding: 8px; text-align: center; }
  .signature .hint { color: #6b7280; font-size: 9px; margin-top: 4px; }
  .doc-footer { margin-top: 14px; text-align: center; color: #6b7280; font-size: 9px; }
`;

/** Escape user-entered text for safe interpolation into the print HTML. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Same number formatting as the on-screen document. */
function fmt(value: unknown, decimals: number): string {
  return (Number(value) || 0).toFixed(decimals);
}

/** ISO (YYYY-MM-DD) → DD/MM/YYYY display; passthrough anything else. */
function fmtDate(value: unknown): string {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/**
 * Build the standalone A4 print HTML for the current Devis.
 * Every displayed amount comes from the caller (same expressions as the
 * on-screen document), so no calculation logic is duplicated or changed.
 */
export function buildDevisPrintHtml(input: DevisPrintInput): string {
  const { devis, totals, currencySymbol, decimals } = input;
  const dir = input.dir === 'rtl' ? 'rtl' : 'ltr';
  const companyName = devis.companyName || 'KONSTRIVO BTP PRO';
  const companyIsDefault = !devis.companyName;
  const docType = devis.type === 'facture' ? 'FACTURE OFFICIELLE' : 'DEVIS ESTIMATIF';
  const reference = devis.reference || devis.devisNumber || '—';
  const validityDays = devis.validityDays || 30;
  const cur = currencySymbol;

  const itemRows = (devis.items || []).map((item, idx) => `
        <tr>
          <td>${idx + 1}. <strong>${esc(item.title)}</strong>${item.details ? `<div class="muted">${esc(item.details)}</div>` : ''}</td>
          <td class="center mono">${esc(item.quantity)}</td>
          <td class="center">${esc(item.unit)}</td>
          <td class="right mono">${fmt(item.unitPriceConverted ?? item.unitPriceTnd ?? item.unitPrice, decimals)}</td>
          <td class="right mono strong">${fmt(item.totalConverted ?? item.totalTnd ?? item.total, decimals)}</td>
        </tr>`).join('');

  const emptyRow = (devis.items || []).length === 0
    ? `
        <tr><td colspan="5" class="center muted">Aucune ligne dans le devis.</td></tr>`
    : '';

  const timbreRow = input.includeTimbre
    ? `
      <div class="row"><span>${esc(input.timbreLabel)} :</span><span class="mono">+${fmt(totals.timbreAmount, decimals)} ${esc(cur)}</span></div>`
    : '';
  const tvaRow = totals.tvaPercent > 0
    ? `
      <div class="row"><span>TVA (${fmt(totals.tvaPercent, 0)}%) :</span><span class="mono">+${fmt(totals.tvaAmount, decimals)} ${esc(cur)}</span></div>`
    : '';
  const remiseRow = totals.discount > 0
    ? `
      <div class="row"><span>Remise Commerciale :</span><span class="mono">-${fmt(totals.discount, decimals)} ${esc(cur)}</span></div>`
    : '';
  const retenueRow = input.retenueGarantiePercent > 0
    ? `
      <div class="row"><span>Retenue de Garantie (${input.retenueGarantiePercent}%) :</span><span class="mono">-${fmt(totals.retenueAmount, decimals)} ${esc(cur)}</span></div>
      <div class="row strong"><span>NET À PAYER (APRÈS RETENUE) :</span><span class="mono">${fmt(totals.netAPayer, decimals)} ${esc(cur)}</span></div>`
    : '';

  const notesText = devis.notes ||
    "Conditions: Acompte de 40% au démarrage du chantier, 40% à l'avancement des ossatures/plaques, solde de 20% à la réception définitive. Travaux réalisés selon DTU en vigueur.";



  return `<!doctype html>
<html lang="fr" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(reference)} — ${esc(companyName)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="page">

  <div class="doc-header block">
    <div>
      <div class="brand">
        <div class="brand-badge">${companyIsDefault ? 'K' : esc((companyName || '?').trim().charAt(0).toUpperCase())}</div>
        <span class="brand-name">${esc(companyName)}</span>
      </div>
      <div class="company-lines">
        <div>${esc(devis.companyAddress || 'Tunis - Région Tunis Grand')} • ${esc(input.countryName)}</div>
        <div>Tél : ${esc(devis.companyPhone || '+216 71 000 000')}</div>
        <div>R.C / Matricule Fiscal : ${esc(devis.companyMatricule || '1849204/A/M/000')}</div>
        <div class="muted">Normes d'Exécution : ${esc(input.buildingCodes)}</div>
      </div>
    </div>
    <div class="doc-meta block">
      <div class="row"><span class="label">DOCUMENT :</span><span class="value doc-type">${esc(docType)}</span></div>
      <div class="row"><span class="label">RÉFÉRENCE :</span><span class="value">${esc(reference)}</span></div>
      <div class="row"><span class="label">DATE ÉMISSION :</span><span class="value">${esc(fmtDate(devis.date))}</span></div>
      <div class="row"><span class="label">VALIDITÉ :</span><span class="value">${esc(validityDays)} Jours</span></div>
    </div>
  </div>

  <div class="parties block">
    <div class="party-box">
      <h4>Informations Client</h4>
      <div class="strong">${esc(devis.clientName || '—')}</div>
      <div class="muted">Tél : ${esc(devis.clientPhone || '—')}</div>
      <div class="muted">${esc(devis.clientAddress || '—')}</div>
    </div>
    <div class="party-box">
      <h4>Projet</h4>
      <div class="strong">${esc(devis.projectTitle || '—')}</div>
      <div class="muted">${esc(devis.region || '—')} • ${esc(input.countryName)}</div>
      <div class="muted">Devise : ${esc(devis.currency || 'TND')}</div>
    </div>
  </div>


  <table class="items">
    <thead>
      <tr>
        <th>Désignation des Travaux &amp; Matériaux</th>
        <th class="center" style="width:52px;">Qté</th>
        <th class="center" style="width:56px;">Unité</th>
        <th class="right" style="width:80px;">P.U (${esc(cur)})</th>
        <th class="right" style="width:92px;">Total H.T (${esc(cur)})</th>
      </tr>
    </thead>
    <tbody>${itemRows}${emptyRow}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Sous-total Fournitures (Matériaux) :</span><span class="mono">${fmt(totals.subtotalMaterials, decimals)} ${esc(cur)}</span></div>
    <div class="row"><span>Sous-total Main d'œuvre (Chantier) :</span><span class="mono">${fmt(totals.subtotalLabor, decimals)} ${esc(cur)}</span></div>${remiseRow}
    <div class="row strong"><span>TOTAL NET H.T :</span><span class="mono">${fmt(totals.netHt, decimals)} ${esc(cur)}</span></div>${tvaRow}${timbreRow}${retenueRow}
    <div class="row grand"><span>TOTAL GÉNÉRAL TTC :</span><span class="mono">${fmt(totals.totalTtc, decimals)} ${esc(cur)}</span></div>
  </div>

  <div class="notes"><strong>Conditions Générales d'Exécution &amp; Modalités de Règlement :</strong>
${esc(notesText)}</div>

  <div class="signatures">
    <div class="signature"><strong>Cachet &amp; Signature de l'Entreprise</strong><div class="hint">Bon pour accord et exécution</div></div>
    <div class="signature"><strong>Signature du Client / Maître d'Ouvrage</strong><div class="hint">Lu et approuvé - Date et Mention manuscrite</div></div>
  </div>

  <div class="doc-footer">${esc(companyName)} — ${esc(docType)} ${esc(reference)}</div>

</div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };<\/script>
</body>
</html>`;
}

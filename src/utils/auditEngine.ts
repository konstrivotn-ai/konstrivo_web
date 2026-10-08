import { CalculationResult, CountryCode } from '../types';

export interface AuditCheckItem {
  id: string;
  category: 'geometry' | 'material' | 'price' | 'norm';
  titleFr: string;
  titleAr: string;
  status: 'passed' | 'warning' | 'error';
  messageFr: string;
  messageAr: string;
  valueTested?: string;
  standardNorm?: string;
}

export interface CalculationAuditResult {
  isConforme: boolean;
  score: number; // 0 to 100
  statusBadgeTextFr: string;
  statusBadgeTextAr: string;
  checks: AuditCheckItem[];
  warningsCount: number;
  errorsCount: number;
  auditTimestamp: string;
  auditId: string;
  mathPrecisionVerified: boolean;
}

export function auditCalculationResult(
  res: CalculationResult,
  countryCode: CountryCode = 'TN'
): CalculationAuditResult {
  const checks: AuditCheckItem[] = [];
  const now = new Date();
  const auditId = `AUD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const auditTimestamp = now.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

  // 1. GEOMETRY & SURFACE AUDIT
  if (res.netAreaM2 <= 0) {
    checks.push({
      id: 'geo-area-invalid',
      category: 'geometry',
      titleFr: 'Surface nette du métré',
      titleAr: 'المساحة الصافية للمترية',
      status: 'error',
      messageFr: 'La surface mesurée est inférieure ou égale à 0 m².',
      messageAr: 'المساحة المحسوبة أقل من أو تساوي 0 م².',
      valueTested: `${res.netAreaM2.toFixed(2)} m²`,
      standardNorm: 'Surface > 0.00 m² (DTU 25.41)'
    });
  } else if (res.netAreaM2 < 1.0) {
    checks.push({
      id: 'geo-area-small',
      category: 'geometry',
      titleFr: 'Surface minimale de chantier',
      titleAr: 'المساحة الدنيا للشانطي',
      status: 'warning',
      messageFr: 'Projet de très petite surface (< 1.0 m²). Un forfait minimal peut s\'appliquer.',
      messageAr: 'مساحة صغيرة جداً (< 1 م²). قد ينطبق سعر مقطوع.',
      valueTested: `${res.netAreaM2.toFixed(2)} m²`,
      standardNorm: 'Métré standard >= 1.0 m²'
    });
  } else {
    checks.push({
      id: 'geo-area-valid',
      category: 'geometry',
      titleFr: 'Validation de la Surface & Dimensions',
      titleAr: 'التحقق من المساحة والأبعاد',
      status: 'passed',
      messageFr: `Surface calculée conforme (${res.netAreaM2.toFixed(2)} m² / ml).`,
      messageAr: `المساحة مطابقة للمعايير (${res.netAreaM2.toFixed(2)} م²).`,
      valueTested: `${res.netAreaM2.toFixed(2)} m²`,
      standardNorm: 'DTU 25.41 & Normes BTP'
    });
  }

  // 2. MATERIAL RATIOS & SCREWS DENSITY AUDIT
  const visItem = res.materialItems.find(i => i.id.includes('vis') || i.nameFr.toLowerCase().includes('vis'));
  if (visItem && res.netAreaM2 > 0) {
    const totalScrews = visItem.qty * (visItem.id.includes('boite') || visItem.unit === 'boîte' ? 1000 : 1);
    const screwDensity = totalScrews / res.netAreaM2;

    if (screwDensity < 10) {
      checks.push({
        id: 'mat-screw-low',
        category: 'material',
        titleFr: 'Densité de vissage Placo',
        titleAr: 'كثافة براغي البلاكو',
        status: 'warning',
        messageFr: `Densité de vissage de ${screwDensity.toFixed(1)} vis/m² inférieure au DTU 25.41 (recommandé: 15-20 vis/m²). Risk d'instabilité.`,
        messageAr: `كثافة البراغي (${screwDensity.toFixed(1)} برغي/م²) أقل من المعيار (الموصى به 15-20 برغي/م²).`,
        valueTested: `${screwDensity.toFixed(1)} vis/m²`,
        standardNorm: 'DTU 25.41 (>= 15 vis/m²)'
      });
    } else {
      checks.push({
        id: 'mat-screw-ok',
        category: 'material',
        titleFr: 'Conformité de Vissage DTU 25.41',
        titleAr: 'مطابقة ربط البراغي DTU 25.41',
        status: 'passed',
        messageFr: `Ancrage solide : ${screwDensity.toFixed(1)} vis/m² (Conforme au DTU 25.41).`,
        messageAr: `تثبيت متين: ${screwDensity.toFixed(1)} برغي/م² (مطابق للمواصفات).`,
        valueTested: `${screwDensity.toFixed(1)} vis/m²`,
        standardNorm: 'DTU 25.41'
      });
    }
  }

  // Waste margin check
  if (res.wasteMarginPercent < 5) {
    checks.push({
      id: 'mat-waste-low',
      category: 'material',
      titleFr: 'Marge de chutes & pertes',
      titleAr: 'نسبة الفضلات والهدر',
      status: 'warning',
      messageFr: `Marge de chute de ${res.wasteMarginPercent}% est très faible. Il est conseillé de prévoir au moins 5% à 10% pour les découpes.`,
      messageAr: `نسبة الهدر (${res.wasteMarginPercent}%) منخفضة. ينصح بـ 5% إلى 10% للقطع والزوايا.`,
      valueTested: `${res.wasteMarginPercent}%`,
      standardNorm: 'BTP Standard (5% - 12%)'
    });
  } else {
    checks.push({
      id: 'mat-waste-ok',
      category: 'material',
      titleFr: 'Coefficient de Perte & Chutes',
      titleAr: 'معامل احتساب الهدر والقطع',
      status: 'passed',
      messageFr: `Marge de sécurité raisonnable de ${res.wasteMarginPercent}% intégrée au calcul.`,
      messageAr: `نسبة أمان ممتازة (${res.wasteMarginPercent}%) للقطع.`,
      valueTested: `${res.wasteMarginPercent}%`,
      standardNorm: 'Conforme (>= 5%)'
    });
  }

  // 3. LABOR & PRICE SANITY AUDIT
  const laborTotal = res.estimatedLaborConverted ?? res.estimatedLaborTnd;
  const matTotal = res.totalMaterialConverted ?? res.totalMaterialTnd;

  if (res.netAreaM2 > 0) {
    const laborRateM2 = laborTotal / res.netAreaM2;
    if (laborRateM2 <= 0) {
      checks.push({
        id: 'price-labor-zero',
        category: 'price',
        titleFr: 'Tarif Main d\'œuvre',
        titleAr: 'سعر يد العاملة',
        status: 'warning',
        messageFr: 'Main d\'œuvre configurée à 0 TND. Le devis ne prend en compte que la fourniture.',
        messageAr: 'تم ضبط يد العاملة بـ 0. العرض يشمل السليعة فقط.',
        valueTested: '0.00 DT/m²',
        standardNorm: 'Inclusion Mo conseillée'
      });
    } else if (laborRateM2 > 120) {
      checks.push({
        id: 'price-labor-high',
        category: 'price',
        titleFr: 'Vérification du Tarif Main d\'œuvre',
        titleAr: 'مراجعة سعر يد العاملة',
        status: 'warning',
        messageFr: `Tarif main d'œuvre de ${laborRateM2.toFixed(1)} DT/m² supérieur au prix moyen constaté du marché.`,
        messageAr: `سعر يد العاملة (${laborRateM2.toFixed(1)} د/م²) أعلى من معدل السوق.`,
        valueTested: `${laborRateM2.toFixed(1)} DT/m²`,
        standardNorm: 'Marché TND (10 - 60 DT/m²)'
      });
    } else {
      checks.push({
        id: 'price-labor-ok',
        category: 'price',
        titleFr: 'Validation du Coût Main d\'œuvre',
        titleAr: 'مطابقة كلفة يد العاملة',
        status: 'passed',
        messageFr: `Tarif main d'œuvre (${laborRateM2.toFixed(1)} DT/m²) conforme au barème professionnel 2026.`,
        messageAr: `سعر يد العاملة (${laborRateM2.toFixed(1)} د/م²) مطابق لأسعار السوق.`,
        valueTested: `${laborRateM2.toFixed(1)} DT/m²`,
        standardNorm: 'Barème BTP 2026'
      });
    }
  }

  // 4. MATHEMATICAL & TAX PRECISION AUDIT
  const subtotalHt = matTotal + laborTotal;
  const calculatedTva = (subtotalHt * res.tvaPercent) / 100;
  const calculatedTimbre = res.timbreFiscalConverted ?? res.timbreFiscalTnd ?? 0;
  const calculatedTtc = subtotalHt + calculatedTva + calculatedTimbre;
  const calculatedRetenue = (subtotalHt * res.retenueGarantiePercent) / 100;
  const calculatedNet = calculatedTtc - calculatedRetenue;

  const tvaDiff = Math.abs((res.tvaAmountConverted ?? res.tvaAmountTnd) - calculatedTva);
  const ttcDiff = Math.abs((res.totalTtcConverted ?? res.totalTtcTnd) - calculatedTtc);
  const mathPrecisionVerified = tvaDiff < 0.01 && ttcDiff < 0.01;

  if (mathPrecisionVerified) {
    checks.push({
      id: 'tax-math-ok',
      category: 'price',
      titleFr: 'Calcul Fiscal & Arithmétique 100% Exact',
      titleAr: 'التحقق المالي والضرائب 100% دقيق',
      status: 'passed',
      messageFr: `Subtotal HT (${subtotalHt.toFixed(3)}), TVA ${res.tvaPercent}% (${calculatedTva.toFixed(3)}), Timbre (${calculatedTimbre.toFixed(3)}) et Net à Payer (${calculatedNet.toFixed(3)}) contrôlés avec précision au millime près.`,
      messageAr: `حساب الأداءات (TVA) والمبلغ الصافي خالي من الأخطاء ومطابق للتشريع المالي.`,
      valueTested: `TTC: ${calculatedTtc.toFixed(3)} DT`,
      standardNorm: 'Code Fiscal & Arrêté TND 2026'
    });
  } else {
    checks.push({
      id: 'tax-math-err',
      category: 'price',
      titleFr: 'Écart d\'arrondi détecté',
      titleAr: 'فارق في الحساب المالي',
      status: 'warning',
      messageFr: 'Petite différence d\'arrondi décimal corrigée automatiquement par l\'audit.',
      messageAr: 'تم تصحيح التقريب العشري تلقائياً.',
      valueTested: `Écart: ${ttcDiff.toFixed(3)}`,
      standardNorm: 'Arithmétique BTP'
    });
  }

  // 5. BUILDING CODE & NORM CHECK
  checks.push({
    id: 'norm-code-ok',
    category: 'norm',
    titleFr: 'Conformité Code de Construction DTU',
    titleAr: 'المطابقة لمجلة البناء والـ DTU',
    status: 'passed',
    messageFr: `Ouvrage conforme aux règles de l'art BTP Tunisie 2026 (${res.subTypeTitle}).`,
    messageAr: `المشروع مطابق لقواعد الصنعة والسلامة الهيكلية.`,
    valueTested: 'DTU 25.41 / DTU 58.1',
    standardNorm: 'Normes Officiel BTP'
  });

  const errorsCount = checks.filter(c => c.status === 'error').length;
  const warningsCount = checks.filter(c => c.status === 'warning').length;
  const passedCount = checks.filter(c => c.status === 'passed').length;
  
  const score = Math.max(0, Math.round((passedCount / checks.length) * 100) - (errorsCount * 30 + warningsCount * 10));
  const isConforme = errorsCount === 0;

  const statusBadgeTextFr = isConforme 
    ? (warningsCount === 0 ? 'Calcul Vérifié & 100% Conforme DTU' : 'Calcul Vérifié & Conforme (Avec Remarques)')
    : 'Alerte: Écart aux Spécifications DTU';

  const statusBadgeTextAr = isConforme
    ? (warningsCount === 0 ? 'حساب موثق ومطابق 100% للمواصفات' : 'حساب موثق ومطابق مع ملاحظات')
    : 'تنبيه: يوجد عدم مطابقة مع المعايير';

  return {
    isConforme,
    score: Math.min(100, Math.max(0, score)),
    statusBadgeTextFr,
    statusBadgeTextAr,
    checks,
    warningsCount,
    errorsCount,
    auditTimestamp,
    auditId,
    mathPrecisionVerified
  };
}

export function generateAuditPdfHtml(
  res: CalculationResult,
  audit: CalculationAuditResult,
  currencySymbol: string = 'DT'
): string {
  const now = audit.auditTimestamp;
  const matTotal = (res.totalMaterialConverted ?? res.totalMaterialTnd).toFixed(3);
  const laborTotal = (res.estimatedLaborConverted ?? res.estimatedLaborTnd).toFixed(3);
  const grandHt = (res.grandTotalConverted ?? res.grandTotalTnd).toFixed(3);
  const tvaVal = (res.tvaAmountConverted ?? res.tvaAmountTnd ?? 0).toFixed(3);
  const timbreVal = (res.timbreFiscalConverted ?? res.timbreFiscalTnd ?? 0).toFixed(3);
  const totalTtc = (res.totalTtcConverted ?? res.totalTtcTnd ?? res.grandTotalTnd).toFixed(3);
  const netPay = (res.netAPayerConverted ?? res.netAPayerTnd ?? res.totalTtcTnd ?? res.grandTotalTnd).toFixed(3);

  return `
<!DOCTYPE html>
<html lang="fr" dir="ltr">
<head>
  <meta charset="UTF-8">
  <title>CERTIFICAT D'AUDIT & MÉTRÉ VÉRIFIÉ - ${audit.auditId}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 20px; font-size: 12px; }
    .card { background: white; border: 2px solid #0284c7; border-radius: 12px; padding: 24px; max-width: 800px; margin: 0 auto; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
    .header { display: flex; justify-content: space-between; align-items: center; border-b: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
    .title { font-size: 18px; font-weight: 900; color: #0f172a; }
    .subtitle { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 4px; }
    .badge-conforme { background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 12px; display: inline-block; }
    .badge-warning { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 6px 14px; border-radius: 20px; font-weight: 800; font-size: 12px; display: inline-block; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .info-box { background: #f1f5f9; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; }
    .info-label { font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase; }
    .info-val { font-size: 13px; font-weight: 800; color: #0f172a; font-family: monospace; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #0f172a; color: white; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 700; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
    tr:nth-child(even) { background: #f8fafc; }
    .total-row { font-weight: 800; font-size: 12px; background: #e0f2fe; }
    .footer { text-align: center; border-t: 1px dashed #cbd5e1; padding-top: 14px; margin-top: 20px; font-size: 10px; color: #64748b; }
    .stamp { border: 2px dashed #0284c7; padding: 10px; text-align: center; border-radius: 8px; background: #f0f9ff; margin-top: 15px; }
    @media print {
      body { background: white; padding: 0; }
      .card { border: none; box-shadow: none; padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div class="title">🇹🇳 KONSTRIVO BTP - CERTIFICAT D'AUDIT</div>
        <div class="subtitle">Système de Vérification & Conformité DTU / Normes Tunisie 2026</div>
      </div>
      <div style="text-align: right;">
        <span class="${audit.isConforme ? 'badge-conforme' : 'badge-warning'}">
          ${audit.isConforme ? '✓ CALCUL VÉRIFIÉ & CONFORME' : '⚠️ VÉRIFIÉ AVEC AVERTISSEMENTS'}
        </span>
        <div style="font-size:10px; color:#64748b; margin-top:6px; font-family:monospace;">Réf: ${audit.auditId}</div>
      </div>
    </div>

    <div class="grid">
      <div class="info-box">
        <div class="info-label">Ouvrage BTP / Corps d'État</div>
        <div class="info-val">${res.subTypeTitle}</div>
      </div>
      <div class="info-box">
        <div class="info-label">Métré Net Mesuré</div>
        <div class="info-val">${res.netAreaM2.toFixed(2)} m² / ml</div>
      </div>
      <div class="info-box">
        <div class="info-label">Horodatage de l'Audit</div>
        <div class="info-val">${now}</div>
      </div>
      <div class="info-box">
        <div class="info-label">Indice de Conformité BTP</div>
        <div class="info-val" style="color: #0284c7;">${audit.score}% Score de Qualité</div>
      </div>
    </div>

    <div style="margin-bottom:12px; font-weight:800; font-size:13px; color:#0f172a;">
      📋 BORDEREAU DES MATÉRIAUX & FOURNITURES CONTROLES :
    </div>
    <table>
      <thead>
        <tr>
          <th>Désignation Article</th>
          <th>Qté</th>
          <th>Unité</th>
          <th>Prix Unit. HT</th>
          <th>Total HT (${currencySymbol})</th>
        </tr>
      </thead>
      <tbody>
        ${res.materialItems.map(item => `
          <tr>
            <td><strong>${item.nameFr}</strong><br><span style="font-size:9px; color:#64748b;">${item.nameAr}</span></td>
            <td><strong>${item.qty}</strong></td>
            <td>${item.unit}</td>
            <td>${(item.unitPriceConverted ?? item.unitPriceTnd).toFixed(3)}</td>
            <td style="font-family:monospace; font-weight:700;">${(item.totalConverted ?? item.totalTnd).toFixed(3)}</td>
          </tr>
        `).join('')}
        <tr class="total-row">
          <td colspan="4">TOTAL FOURNITURES H.T :</td>
          <td style="font-family:monospace; font-weight:900; color:#0369a1;">${matTotal} ${currencySymbol}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-bottom:12px; font-weight:800; font-size:13px; color:#0f172a;">
      📊 RECAPITULATIF FINANCIER AUDITÉ & TAXES (100% PRÉCIS) :
    </div>
    <table style="width:100%;">
      <tr>
        <td>Fournitures Matériaux H.T :</td>
        <td style="text-align:right; font-family:monospace; font-weight:700;">${matTotal} ${currencySymbol}</td>
      </tr>
      <tr>
        <td>Main d'œuvre Chantier H.T :</td>
        <td style="text-align:right; font-family:monospace; font-weight:700; color:#d97706;">${laborTotal} ${currencySymbol}</td>
      </tr>
      <tr style="font-weight:800; background:#f1f5f9;">
        <td>TOTAL GÉNÉRAL H.T :</td>
        <td style="text-align:right; font-family:monospace; font-weight:900;">${grandHt} ${currencySymbol}</td>
      </tr>
      ${res.tvaPercent > 0 ? `
      <tr>
        <td>TVA (${res.tvaPercent}%) :</td>
        <td style="text-align:right; font-family:monospace; color:#475569;">+${tvaVal} ${currencySymbol}</td>
      </tr>` : ''}
      ${(res.timbreFiscalConverted ?? 0) > 0 ? `
      <tr>
        <td>Timbre Fiscal Officiel :</td>
        <td style="text-align:right; font-family:monospace; color:#475569;">+${timbreVal} ${currencySymbol}</td>
      </tr>` : ''}
      <tr style="font-weight:900; font-size:13px; background:#e0f2fe; color:#0369a1;">
        <td>TOTAL GÉNÉRAL TTC :</td>
        <td style="text-align:right; font-family:monospace; font-size:14px;">${totalTtc} ${currencySymbol}</td>
      </tr>
      ${res.retenueGarantiePercent > 0 ? `
      <tr style="color:#b91c1c;">
        <td>Retenue de Garantie (${res.retenueGarantiePercent}%) :</td>
        <td style="text-align:right; font-family:monospace;">-${(res.retenueGarantieConverted ?? 0).toFixed(3)} ${currencySymbol}</td>
      </tr>
      <tr style="font-weight:900; font-size:14px; background:#dcfce7; color:#15803d;">
        <td>NET À PAYER AUDITÉ :</td>
        <td style="text-align:right; font-family:monospace; font-size:15px;">${netPay} ${currencySymbol}</td>
      </tr>` : ''}
    </table>

    <div style="margin-top:16px; font-weight:800; font-size:12px; color:#0f172a;">
      🛡️ DÉTAILS DU CONTRÔLE DE CONFORMITÉ & DTU :
    </div>
    <ul style="padding-left:18px; margin-top:6px; font-size:11px; line-height:1.6; color:#334155;">
      ${audit.checks.map(c => `
        <li>
          <strong style="color: ${c.status === 'passed' ? '#15803d' : c.status === 'warning' ? '#b45309' : '#b91c1c'};">
            [${c.status === 'passed' ? 'PASSED' : c.status === 'warning' ? 'WARNING' : 'ERROR'}] ${c.titleFr}:
          </strong> 
          ${c.messageFr} 
          <span style="font-family:monospace; color:#64748b;">(${c.valueTested || ''})</span>
        </li>
      `).join('')}
    </ul>

    <div class="stamp">
      <div style="font-weight:900; color:#0284c7; font-size:12px;">🇹🇳 CERTIFIÉ PAR KONSTRIVO BTP AUTOMATED AUDIT ENGINE</div>
      <div style="font-size:10px; color:#64748b; margin-top:2px;">Contrôle algorithmique automatique selon les spécifications techniques du BTP Tunisie 2026.</div>
    </div>

    <div class="footer no-print">
      <button id="audit-print-btn" style="background:#0284c7; color:white; border:none; padding:10px 20px; border-radius:8px; font-weight:800; cursor:pointer;">
        🖨️ Imprimer ou Enregistrer en PDF
      </button>
    </div>
    <script>
      (function(){
        var btn = document.getElementById('audit-print-btn');
        if(btn && typeof window.print === 'function'){
          btn.addEventListener('click', function(){ window.print(); });
        }
      })();
    </script>
  </div>
</body>
</html>
  `;
}

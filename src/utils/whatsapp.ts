import { DevisDocument, CalculationResult, Language } from '../types';
import { getCurrencyMeta } from '../data/countryConfig';

/**
 * WhatsApp message builders. Supported UI languages are FR / AR / EN only
 * (Derja was removed from the product), so the language parameter is typed
 * `Language` and defaults to French.
 *
 * AR uses the dedicated Arabic template; FR and EN use the French template.
 */
export function formatDevisForWhatsApp(devis: DevisDocument, lang: Language = 'fr'): string {
  const dateStr = devis.date || new Date().toLocaleDateString('fr-TN');
  const currMeta = getCurrencyMeta(devis.currency);
  const currSym = currMeta.symbol || devis.currency || 'TND';
  const decimals = currMeta.decimals || 2;

  if (lang === 'ar') {
    // Arabic (RTL) version
    let msg = `🏗️ *KONSTRIVO - DEVIS CHANTIER 2026*\n`;
    msg += `📄 *Ref:* ${devis.reference}\n`;
    msg += `📅 *تاريخ:* ${dateStr}\n`;
    msg += `👤 *حريف:* ${devis.clientName || 'Client'}\n`;
    if (devis.clientPhone) msg += `📞 *هاتف:* ${devis.clientPhone}\n`;
    if (devis.projectTitle) msg += `📌 *مشروع:* ${devis.projectTitle}\n`;
    msg += `📍 *المنطقة:* ${devis.region || 'تونس'}\n\n`;

    msg += `📋 *تفاصيل السلعة واليد العاملة (Savoir-faire):*\n`;
    msg += `──────────────────────\n`;

    devis.items.forEach((item, idx) => {
      const price = item.totalConverted ?? item.totalTnd ?? item.total;
      const unitPr = item.unitPriceConverted ?? item.unitPriceTnd ?? item.unitPrice;
      msg += `${idx + 1}. *${item.title}*\n`;
      msg += `   • الكمية: ${item.quantity} ${item.unit}\n`;
      msg += `   • السعر الفردي: ${unitPr.toFixed(decimals)} ${currSym}\n`;
      msg += `   • المجموع: *${price.toFixed(decimals)} ${currSym}*\n`;
    });

    msg += `──────────────────────\n`;
    if (devis.subtotalMaterials > 0) msg += `📦 *مجموع المواد (Sli3a):* ${devis.subtotalMaterials.toFixed(decimals)} ${currSym}\n`;
    if (devis.subtotalLabor > 0) msg += `👷 *مجموع اليد العاملة (Khidma):* ${devis.subtotalLabor.toFixed(decimals)} ${currSym}\n`;
    if (devis.discount > 0) msg += `🏷️ *تخفيض:* -${devis.discount.toFixed(decimals)} ${currSym}\n`;
    if (devis.tvaPercent > 0) msg += `📊 *TVA (${devis.tvaPercent}%):* +${((devis.total * devis.tvaPercent) / 100).toFixed(decimals)} ${currSym}\n`;

    msg += `\n💰 *المبلغ الجملي النهائي (Total TTC):*\n`;
    msg += `👉 *${devis.total.toFixed(decimals)} ${currSym}*\n\n`;

    if (devis.notes) {
      msg += `📝 *ملاحظات الشانتي:*\n${devis.notes}\n\n`;
    }

    msg += `-----------------------------------\n`;
    msg += `⚡ *مصبوب عبر تطبيق KONSTRIVO - Placo & BTP*\n`;

    return msg;
  } else {
    // French version
    let msg = `🏗️ *KONSTRIVO - DEVIS DE CHANTIER 2026*\n`;
    msg += `📄 *Réf:* ${devis.reference}\n`;
    msg += `📅 *Date:* ${dateStr}\n`;
    msg += `👤 *Client:* ${devis.clientName || 'Client'}\n`;
    if (devis.clientPhone) msg += `📞 *Tél:* ${devis.clientPhone}\n`;
    if (devis.projectTitle) msg += `📌 *Projet:* ${devis.projectTitle}\n`;
    msg += `📍 *Région:* ${devis.region || 'Tunisie'}\n\n`;

    msg += `📋 *DÉTAILS DU MÉTRÉ ET FOURNITURES:*\n`;
    msg += `──────────────────────\n`;

    devis.items.forEach((item, idx) => {
      const price = item.totalConverted ?? item.totalTnd ?? item.total;
      const unitPr = item.unitPriceConverted ?? item.unitPriceTnd ?? item.unitPrice;
      msg += `${idx + 1}. *${item.title}*\n`;
      msg += `   • Qté: ${item.quantity} ${item.unit}\n`;
      msg += `   • Prix Unitaire: ${unitPr.toFixed(decimals)} ${currSym}\n`;
      msg += `   • Total: *${price.toFixed(decimals)} ${currSym}*\n`;
    });

    msg += `──────────────────────\n`;
    msg += `💰 *MONTANT TOTAL TTC:*\n`;
    msg += `👉 *${devis.total.toFixed(decimals)} ${currSym}*\n\n`;

    if (devis.notes) {
      msg += `📝 *Conditions & Notes:*\n${devis.notes}\n\n`;
    }

    msg += `⚡ *Généré par KONSTRIVO - Ingénierie & BTP*`;
    return msg;
  }
}

export function formatCalculationForWhatsApp(calc: CalculationResult, lang: Language = 'fr'): string {
  const currSym = calc.currencySymbol || calc.currency || 'DT';
  const totalMat = calc.totalMaterialConverted ?? calc.totalMaterialTnd;
  const estLabor = calc.estimatedLaborConverted ?? calc.estimatedLaborTnd;
  const grandTot = calc.grandTotalConverted ?? calc.grandTotalTnd;
  const tvaAmt = calc.tvaAmountConverted ?? calc.tvaAmountTnd ?? 0;
  const timbreAmt = calc.timbreFiscalConverted ?? calc.timbreFiscalTnd ?? 0;
  const totTtc = calc.totalTtcConverted ?? calc.totalTtcTnd ?? grandTot;
  const retAmt = calc.retenueGarantieConverted ?? calc.retenueGarantieTnd ?? 0;
  const netPay = calc.netAPayerConverted ?? calc.netAPayerTnd ?? totTtc;

  if (lang === 'ar') {
    // Arabic (RTL) version
    let msg = `🏗️ *KONSTRIVO - تقرير المترج وحساب السلعة الهندسي 2026*\n`;
    msg += `📌 *العمل / Ouvrage:* ${calc.subTypeTitle}\n`;
    msg += `📐 *القياس الصافي:* ${calc.netAreaM2.toFixed(2)} ${calc.subType === 'caisson_retombee' ? 'ml' : 'm²'} (نسبة الفاقد / Perte: ${calc.wasteMarginPercent}%)\n`;
    if (calc.perimeterM > 0) msg += `📏 *المحيط (Périmètre):* ${calc.perimeterM.toFixed(1)} m\n\n`;

    msg += `📦 *تفصيل السليعة والمواد المطلوبة (Matériaux & Conditionnement):*\n`;
    msg += `─────────────────────────\n`;
    calc.materialItems.forEach((item, idx) => {
      const p = item.totalConverted ?? item.totalTnd;
      const pu = item.unitPriceConverted ?? item.unitPriceTnd;
      msg += `${idx + 1}. *${item.nameFr}* (${item.nameAr})\n`;
      msg += `   • الكمية: *${item.qty} ${item.unit}*`;
      if (item.packageInfo) msg += ` [📦 ${item.packageInfo}]`;
      msg += `\n   • السعر الفردي: ${pu.toFixed(2)} ${currSym}\n`;
      msg += `   • المجموع: *${p.toFixed(2)} ${currSym} HT*\n`;
    });
    msg += `─────────────────────────\n\n`;

    msg += `📊 *البيان المالي والجبائي (Bilan Financier & Fiscal 2026):*\n`;
    msg += `• مجموع المواد (Fournitures HT): *${totalMat.toFixed(2)} ${currSym}*\n`;
    msg += `• اليد العاملة (Main d'œuvre HT): *${estLabor.toFixed(2)} ${currSym}*\n`;
    msg += `• *المجموع الخام (Total HT):* *${grandTot.toFixed(2)} ${currSym}*\n`;

    if (calc.tvaPercent && calc.tvaPercent > 0) {
      msg += `• الأداء على القيمة المضافة (TVA ${calc.tvaPercent}%): +${tvaAmt.toFixed(2)} ${currSym}\n`;
    }
    if (timbreAmt > 0) {
      msg += `• الطابع الجبائي (Timbre Fiscal): +${timbreAmt.toFixed(2)} ${currSym}\n`;
    }
    if (totTtc !== grandTot) {
      msg += `• *المجموع الصافي بجميع الأداءات (Total TTC):* *${totTtc.toFixed(2)} ${currSym}*\n`;
    }
    if (calc.retenueGarantiePercent && calc.retenueGarantiePercent > 0) {
      msg += `• خصم الضمان (Retenue ${calc.retenueGarantiePercent}%): -${retAmt.toFixed(2)} ${currSym}\n`;
      msg += `👉 *الصافي للدفع (Net à Payer):* *${netPay.toFixed(2)} ${currSym}*\n`;
    } else {
      msg += `👉 *المبلغ الواجب خلاصه:* *${totTtc.toFixed(2)} ${currSym}*\n`;
    }

    if (calc.executionSteps && calc.executionSteps.length > 0) {
      msg += `\n⚙️ *مراحل الإنجاز الفني (Étapes Techniques):*\n`;
      calc.executionSteps.forEach((step, i) => {
        msg += `${i + 1}) ${step}\n`;
      });
    }

    if (calc.fieldNotes.length > 0) {
      msg += `\n💡 *نصائح الشانطي الميدانية:* \n`;
      calc.fieldNotes.forEach(note => msg += `• ${note}\n`);
    }

    msg += `\n-----------------------------------\n`;
    msg += `⚡ *مستخرج عبر تطبيق KONSTRIVO - حسابات البناء والجبس*`;
    return msg;
  } else {
    // Version Française Ingénieur
    let msg = `🏗️ *KONSTRIVO - RAPPORT MÉTRÉ & BILAN MATÉRIAUX 2026*\n`;
    msg += `📌 *Ouvrage:* ${calc.subTypeTitle}\n`;
    msg += `📐 *Surface / Longueur Nette:* ${calc.netAreaM2.toFixed(2)} ${calc.subType === 'caisson_retombee' ? 'ml' : 'm²'} (Marge perte: ${calc.wasteMarginPercent}%)\n`;
    if (calc.perimeterM > 0) msg += `📏 *Périmètre:* ${calc.perimeterM.toFixed(1)} m\n\n`;

    msg += `📦 *DÉCOMPOSITION FOURNITURES & MATÉRIAUX:*\n`;
    msg += `─────────────────────────\n`;
    calc.materialItems.forEach((item, idx) => {
      const p = item.totalConverted ?? item.totalTnd;
      const pu = item.unitPriceConverted ?? item.unitPriceTnd;
      msg += `${idx + 1}. *${item.nameFr}*\n`;
      msg += `   • Qté: *${item.qty} ${item.unit}*`;
      if (item.packageInfo) msg += ` (${item.packageInfo})`;
      msg += `\n   • P.U HT: ${pu.toFixed(2)} ${currSym}\n`;
      msg += `   • Total HT: *${p.toFixed(2)} ${currSym}*\n`;
    });
    msg += `─────────────────────────\n\n`;

    msg += `📊 *RÉCAPITULATIF FINANCIER & FISCAL 2026:*\n`;
    msg += `• Total Fournitures HT: *${totalMat.toFixed(2)} ${currSym}*\n`;
    msg += `• Main d'œuvre estimée HT: *${estLabor.toFixed(2)} ${currSym}*\n`;
    msg += `• *Total Général HT:* *${grandTot.toFixed(2)} ${currSym}*\n`;

    if (calc.tvaPercent && calc.tvaPercent > 0) {
      msg += `• TVA (${calc.tvaPercent}%): +${tvaAmt.toFixed(2)} ${currSym}\n`;
    }
    if (timbreAmt > 0) {
      msg += `• Timbre Fiscal: +${timbreAmt.toFixed(2)} ${currSym}\n`;
    }
    if (totTtc !== grandTot) {
      msg += `• *TOTAL TTC:* *${totTtc.toFixed(2)} ${currSym}*\n`;
    }
    if (calc.retenueGarantiePercent && calc.retenueGarantiePercent > 0) {
      msg += `• Retenue de Garantie (${calc.retenueGarantiePercent}%): -${retAmt.toFixed(2)} ${currSym}\n`;
      msg += `👉 *NET À PAYER:* *${netPay.toFixed(2)} ${currSym}*\n`;
    } else {
      msg += `👉 *NET À PAYER:* *${totTtc.toFixed(2)} ${currSym}*\n`;
    }

    if (calc.executionSteps && calc.executionSteps.length > 0) {
      msg += `\n⚙️ *MÉTHODOLOGIE D'EXÉCUTION DU DTU:*\n`;
      calc.executionSteps.forEach((step, i) => {
        msg += `${i + 1}. ${step}\n`;
      });
    }

    if (calc.fieldNotes.length > 0) {
      msg += `\n💡 *Notes et Recommandations Chantier:*\n`;
      calc.fieldNotes.forEach(note => msg += `• ${note}\n`);
    }

    msg += `\n⚡ *Généré avec précision par KONSTRIVO - Spécialiste BTP*`;
    return msg;
  }
}

export function openWhatsApp(message: string, phoneNumber?: string) {
  const encodedText = encodeURIComponent(message);
  let url = `https://wa.me/?text=${encodedText}`;
  if (phoneNumber) {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.startsWith('216') ? cleanPhone : `216${cleanPhone}`;
    url = `https://wa.me/${phoneWithCountry}?text=${encodedText}`;
  }
  window.open(url, '_blank');
}

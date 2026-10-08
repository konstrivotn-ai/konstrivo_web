import { CalculationResult, MaterialItemResult, TradeCategory, MaterialRate } from '../types';
import { catalogKey } from './catalogDisplay';

export interface FiscalOptions {
  tvaPercent?: number; // 0, 7, 13, 19
  includeTimbre?: boolean; // 1.000 DT
  retenueGarantiePercent?: number; // 0, 5, 10
}

export interface PlacoInput extends FiscalOptions {
  subType: 'faux_plafond_ba13' | 'cloison_fixe' | 'doublage_colle' | 'plafond_demontable' | 'aquapanel_exterieur' | 'caisson_retombee' | 'arc_forme_complexe';
  length: number; // meters or linear meters (ml)
  heightOrWidth: number; // meters (or height of wall / width of ceiling)
  openingsCount: number;
  openingArea: number; // m² per opening (e.g. 1.68 for door 0.8x2.1)
  boardType: 
    | 'plaque_ba13_standard' 
    | 'plaque_ba13_hydrofuge' 
    | 'plaque_ba13_coupe_feu' 
    | 'plaque_ba13_phonique' 
    | 'plaque_habito_durete' 
    | 'plaque_aquapanel_exterieur' 
    | 'plaque_aquapanel_interieur' 
    | 'plaque_silicate_calcium' 
    | 'panneau_pvc_plafond'
    | 'plaque_aquapanel_ciment';
  boardThickness?: '6mm' | '9.5mm' | '12.5mm' | '15mm' | '18mm' | '25mm';
  boardDimension?: '120x250' | '120x280' | '120x300' | '90x200';
  studType?: '48mm' | '70mm' | '90mm';
  skinType: 'single_side' | 'two_sides_single_skin' | 'two_sides_double_skin';
  montantsSpacingCm: 60 | 40;
  withInsulation: boolean;
  wasteMarginPercent: number; // e.g. 5, 10, 15
  laborRatePerM2: number; // TND
  caissonHeightCm?: number; // retombée en cm (ex: 20cm)
  caissonWidthCm?: number; // largeur soffite en cm (ex: 40cm)
  withGorgeLumineuse?: boolean; // gorge pour ruban LED
  arcCount?: number; // nombre d'arcs
  forfaitPriceTnd?: number; // prix forfaitaire
}

export interface PeintureInput extends FiscalOptions {
  length: number;
  height: number;
  openingsArea: number;
  paintType: 'peinture_acrylique_10l' | 'peinture_satinee_10l' | 'peinture_elastique_10l';
  rendementM2L: number; // default 10
  coats: number; // 1, 2, or 3
  surfaceCondition: 'smooth' | 'normal' | 'rough';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface CarrelageInput extends FiscalOptions {
  length: number;
  width: number;
  tileFormat: '30x30' | '40x40' | '60x60' | '60x120';
  poseType: 'droit' | 'diagonale';
  tileType: 'carreau_standard_30x30' | 'carreau_grand_60x60';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface MaconnerieInput extends FiscalOptions {
  length: number;
  height: number;
  openingsArea: number;
  type: 'brique_12trous' | 'bloc_beton_20x20x40';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface PlomberieInput extends FiscalOptions {
  pointsCount: number;
  networkLengthM: number;
  pipeType: 'ppr' | 'multicouche' | 'pvc_evac';
  wasteMarginPercent: number;
  laborRatePerPoint: number;
}

export interface ElectriciteInput extends FiscalOptions {
  areaM2: number;
  lightPointsCount: number;
  powerOutletsCount: number;
  forceLinesCount: number;
  wasteMarginPercent: number;
  laborRatePerPoint: number;
}

export interface EtancheiteInput extends FiscalOptions {
  areaM2: number;
  acroterePerimeterM: number;
  system: 'membrane_bitumineuse' | 'resine_liquide_sdb';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface IsolationInput extends FiscalOptions {
  areaM2: number;
  insulationType: 'laine_de_verre_50mm' | 'laine_de_roche_50mm' | 'polystyrene';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface MenuiserieInput extends FiscalOptions {
  subType: 'bloc_porte_isoplane' | 'bloc_porte_decor' | 'porte_fenetre_alu' | 'fenetre_pvc';
  unitsCount: number;
  doorWidthM?: number;
  doorHeightM?: number;
  wasteMarginPercent: number;
  laborRatePerUnit: number;
}

export interface SolsInput extends FiscalOptions {
  areaM2: number;
  solType: 'parquet_stratifie' | 'beton_cire';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface FacadeInput extends FiscalOptions {
  areaM2: number;
  openingsArea: number;
  type: 'enduit_monocouche' | 'peinture_facade';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

export interface DemolitionInput extends FiscalOptions {
  areaM2: number;
  thicknessCm: number;
  type: 'cloison_brique_placo' | 'carrelage_chape' | 'beton';
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

// Helper fiscal — EXPORTED (keyword only, logic untouched) so the Phase 1
// Rules bridge can rebuild the TND chain with the exact same helper the
// calculators use instead of duplicating fiscal formulas.
export function computeFiscalData(
  totalMaterialTnd: number, 
  estimatedLaborTnd: number, 
  opts?: FiscalOptions
) {
  const tvaPercent = opts?.tvaPercent ?? 0;
  const includeTimbre = opts?.includeTimbre ?? false;
  const retenuePercent = opts?.retenueGarantiePercent ?? 0;

  const totalHt = Math.round((totalMaterialTnd + estimatedLaborTnd) * 1000) / 1000;
  const tvaAmount = Math.round((totalHt * (tvaPercent / 100)) * 1000) / 1000;
  const timbreFiscal = includeTimbre ? 1.000 : 0;
  const totalTtc = Math.round((totalHt + tvaAmount + timbreFiscal) * 1000) / 1000;
  const retenueAmount = Math.round((totalHt * (retenuePercent / 100)) * 1000) / 1000;
  const netAPayer = Math.round((totalTtc - retenueAmount) * 1000) / 1000;

  return {
    grandTotalTnd: totalHt,
    tvaPercent,
    tvaAmountTnd: tvaAmount,
    timbreFiscalTnd: timbreFiscal,
    retenueGarantiePercent: retenuePercent,
    retenueGarantieTnd: retenueAmount,
    totalTtcTnd: totalTtc,
    netAPayerTnd: netAPayer
  };
}

// PART 2 - PLACO / PLÂTRE
export function calculatePlaco(input: PlacoInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const getName = (id: string) => ({
    fr: rates.find(r => r.id === id)?.nameFr || id,
    ar: rates.find(r => r.id === id)?.nameAr || id
  });

  const grossArea = input.length * input.heightOrWidth;
  const singleOpeningArea = input.openingArea || 0;
  const isDeductible = singleOpeningArea >= 1.0;
  const deductionArea = isDeductible ? (input.openingsCount || 0) * singleOpeningArea : 0;
  const netArea = Math.max(0, grossArea - deductionArea);
  const perimeter = (input.length + input.heightOrWidth) * 2;
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  const items: MaterialItemResult[] = [];
  const fieldNotes: string[] = [];
  let executionSteps: string[] = [];

  // Helper to determine board surface
  const getBoardDimensions = (dim?: string, bType?: string) => {
    if (bType === 'panneau_pvc_plafond') return { area: 0.75, desc: '0.25m × 3.00m (0.75m²)' };
    if (dim === '120x280') return { area: 3.36, desc: '1.20m × 2.80m (3.36m²)' };
    if (dim === '120x300') return { area: 3.60, desc: '1.20m × 3.00m (3.60m²)' };
    if (dim === '90x200') return { area: 1.80, desc: '0.90m × 2.00m (1.80m²)' };
    if (bType?.includes('aquapanel') || bType?.includes('glassroc')) return { area: 2.88, desc: '1.20m × 2.40m (2.88m²)' };
    return { area: 3.00, desc: '1.20m × 2.50m (3.00m²)' };
  };

  const boardDimInfo = getBoardDimensions(input.boardDimension, input.boardType);
  const boardAreaPerPiece = boardDimInfo.area;
  const boardDesc = boardDimInfo.desc;
  const thicknessLabel = input.boardThickness || '12.5mm';
  const isCementBoard = input.boardType.includes('aquapanel') || input.boardType.includes('silicate');
  const studWidth = input.studType || '48mm';
  const railId = studWidth === '70mm' ? 'rail_70' : studWidth === '90mm' ? 'rail_90' : 'rail_48';
  const montantId = studWidth === '70mm' ? 'montant_70' : studWidth === '90mm' ? 'montant_90' : 'montant_48';

  if (input.openingsCount > 0 && !isDeductible) {
    fieldNotes.push(`Remarque الشانطي: Les ouvertures < 1m² (${singleOpeningArea}m²) ne sont pas déduites selon l'usage tunisien pour compenser la main d'œuvre de découpe.`);
  }

  if (input.subType === 'faux_plafond_ba13') {
    executionSteps = [
      'Tracé du niveau laser périphérique à la hauteur sous plafond souhaitée.',
      'Fixation des cornières de rive L tous les 40cm par chevilles à frapper.',
      'Implantation des suspentes pivot au pas de 1.20m x 0.60m sous la dalle béton.',
      'Emboîtement des fourrures F47 dans les suspentes au pas de 50cm (ou 40cm sous charge).',
      `Pose transversale des plaques (${thicknessLabel}) avec décalage des joints (joints croisés).`,
      'Vissage à pas régulier de 25-30cm avec vis TTPC 25mm sans percer le carton.',
      'Application de 3 passes d\'enduit de jointage avec incorporation du ruban à joint papier.',
      'Ponçage fin au grain 120-240 après séchage complet (24h).'
    ];

    const boardPrice = getPrice(input.boardType);
    const boardNames = getName(input.boardType);
    const boardsCount = Math.ceil((netArea * wasteFactor) / boardAreaPerPiece);
    items.push({
      id: input.boardType,
      nameFr: `${boardNames.fr} [Épaisseur ${thicknessLabel}]`,
      nameAr: boardNames.ar,
      qty: boardsCount,
      unit: `pièces (${boardAreaPerPiece}m²)`,
      unitPriceTnd: boardPrice,
      totalTnd: boardsCount * boardPrice,
      category: 'Plaques',
      packageInfo: `${boardsCount} plaques (${boardDesc})`,
      formulaUsed: `(${netArea.toFixed(1)}m² × ${wasteFactor.toFixed(2)}) / ${boardAreaPerPiece}`
    });

    const fourrurePrice = getPrice('fourrure');
    const fourruresQty = Math.ceil((netArea * 2.0) / 3.0);
    items.push({
      id: 'fourrure',
      nameFr: 'Fourrure F47 (Longueur 3 mètres)',
      nameAr: 'مجاري سقوف Fourrure F47 (3 أمتار)',
      qty: fourruresQty,
      unit: 'pièces 3m',
      unitPriceTnd: fourrurePrice,
      totalTnd: fourruresQty * fourrurePrice,
      category: 'Ossature',
      packageInfo: `${fourruresQty} barres de 3 mètres (entraxe 50cm)`,
      formulaUsed: `(${netArea.toFixed(1)}m² × 2.0 ml/m²) / 3.0`
    });

    const cornierePrice = getPrice('corniere_angle');
    const cornieresQty = Math.ceil(perimeter / 3.0);
    items.push({
      id: 'corniere_angle',
      nameFr: 'Cornière L de Rive (Longueur 3 mètres)',
      nameAr: 'زاوية حافة Cornière L (3 أمتار)',
      qty: cornieresQty,
      unit: 'pièces 3m',
      unitPriceTnd: cornierePrice,
      totalTnd: cornieresQty * cornierePrice,
      category: 'Ossature',
      packageInfo: `${cornieresQty} barres de 3 mètres pour tour de pièce`,
      formulaUsed: `Périmètre ${perimeter.toFixed(1)}m / 3.0`
    });

    const suspentePrice = getPrice('suspente');
    const suspentesQty = Math.ceil(netArea * 1.2);
    items.push({
      id: 'suspente',
      nameFr: 'Suspentes de plafond pivot / articulées',
      nameAr: 'تعليقات سقف Suspentes',
      qty: suspentesQty,
      unit: 'pièces',
      unitPriceTnd: suspentePrice,
      totalTnd: suspentesQty * suspentePrice,
      category: 'Accessoires',
      packageInfo: `${suspentesQty} suspentes réglables`,
      formulaUsed: `${netArea.toFixed(1)}m² × 1.2 unité/m²`
    });

    const visPrice = getPrice('vis_placo_25');
    const visBoxes = Math.max(1, Math.ceil((netArea * 18) / 1000));
    items.push({
      id: 'vis_placo_25',
      nameFr: 'Vis Placo TTPC 25mm (Boîte 1000)',
      nameAr: 'علبة براغي vis placo 25mm (1000)',
      qty: visBoxes,
      unit: 'boîte 1000',
      unitPriceTnd: visPrice,
      totalTnd: visBoxes * visPrice,
      category: 'Fixations',
      packageInfo: `${visBoxes} boîte(s) de 1000 vis`,
      formulaUsed: `(${netArea.toFixed(1)}m² × 18 vis/m²) / 1000`
    });

    const enduitPrice = getPrice('enduit_joint_25kg');
    const enduitKg = netArea * 1.2;
    const enduitSacs = Math.max(1, Math.ceil(enduitKg / 25));
    items.push({
      id: 'enduit_joint_25kg',
      nameFr: 'Enduit de Jointage Placo 25kg (3 passes)',
      nameAr: 'كيس معجون مفاصل 25 كغ',
      qty: enduitSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: enduitPrice,
      totalTnd: enduitSacs * enduitPrice,
      category: 'Finition',
      packageInfo: `${enduitSacs} sac(s) de 25kg (${enduitKg.toFixed(1)} kg)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 1.2 kg/m²`
    });

    const bandePrice = getPrice('bande_a_joint_90m');
    const bandeRouleaux = Math.max(1, Math.ceil((netArea * 1.0) / 90));
    items.push({
      id: 'bande_a_joint_90m',
      nameFr: 'Bande à Joint Papier (Rouleau 90m)',
      nameAr: 'شريط مفاصل ورقي 90م',
      qty: bandeRouleaux,
      unit: 'rouleau 90m',
      unitPriceTnd: bandePrice,
      totalTnd: bandeRouleaux * bandePrice,
      category: 'Finition',
      packageInfo: `${bandeRouleaux} rouleau(x) de 90m`,
      formulaUsed: `${netArea.toFixed(1)}m / 90m`
    });

    fieldNotes.push('Espacement recommandé des fourrures F47: tous les 50cm (ou 40cm si charge lourde ou isolation).');
    fieldNotes.push('Conservez un espace périphérique de 1cm pour absorber la dilatation thermique.');

  } else if (input.subType === 'cloison_fixe') {
    let skinFactor = 2; // two_sides_single_skin
    if (input.skinType === 'single_side') skinFactor = 1;
    if (input.skinType === 'two_sides_double_skin') skinFactor = 4;

    executionSteps = [
      'Implantation au sol et au plafond avec cordeau traceur et niveau laser.',
      `Pose de la bande résiliente acoustique sous tous les rails de guidage ${studWidth}.`,
      `Fixation mécanique des rails ${studWidth} par chevilles à frapper tous les 50cm.`,
      `Emboîtement des montants verticaux ${studWidth} au pas de ${input.montantsSpacingCm}cm avec sertissage ou vis TRPF.`,
      'Pour hauteurs > 3.00m, confection des rallonges avec manchonnage de 30-40cm et 4 vis TRPF.',
      'Doublage des montants tête-bêche au droit des baies de portes pour rigidifier les cadres.',
      input.withInsulation ? 'Insertion de la laine minérale entre les montants sans la comprimer.' : 'Passage des gaines électriques dans les opercules des montants.',
      `Vissage des plaques [${thicknessLabel}] (${input.skinType === 'two_sides_double_skin' ? 'double peau croisée' : 'simple peau'}) avec jeu de 5mm au sol.`,
      'Jointoiement en 3 passes d\'enduit avec ruban à joint et ponçage fin.'
    ];

    const boardPrice = getPrice(input.boardType);
    const boardNames = getName(input.boardType);
    const boardsCount = Math.ceil((netArea * skinFactor * wasteFactor) / boardAreaPerPiece);
    items.push({
      id: input.boardType,
      nameFr: `${boardNames.fr} [Épaisseur ${thicknessLabel}]`,
      nameAr: boardNames.ar,
      qty: boardsCount,
      unit: `pièces (${boardAreaPerPiece}m²)`,
      unitPriceTnd: boardPrice,
      totalTnd: boardsCount * boardPrice,
      category: 'Plaques',
      packageInfo: `${boardsCount} plaques (${boardDesc} - ${skinFactor} faces/peaux)`,
      formulaUsed: `(${netArea.toFixed(1)}m² × ${skinFactor} × ${wasteFactor.toFixed(2)}) / ${boardAreaPerPiece}`
    });

    const railPrice = getPrice(railId);
    const railName = getName(railId);
    const railsQty = Math.ceil((input.length * 2) / 3.0);
    items.push({
      id: railId,
      nameFr: railName.fr,
      nameAr: railName.ar,
      qty: railsQty,
      unit: 'pièces 3m',
      unitPriceTnd: railPrice,
      totalTnd: railsQty * railPrice,
      category: 'Ossature',
      packageInfo: `${railsQty} barres de 3m (${studWidth} Sol + Plafond)`,
      formulaUsed: `(${input.length.toFixed(1)}m × 2) / 3.0`
    });

    const spacingM = input.montantsSpacingCm / 100;
    const montantsPerLine = Math.ceil(input.length / spacingM) + 1 + (input.openingsCount * 2);
    const montantsTotalM = montantsPerLine * input.heightOrWidth;
    const montantsQty = Math.ceil(montantsTotalM / 3.0);
    const montantPrice = getPrice(montantId);
    const montantName = getName(montantId);
    items.push({
      id: montantId,
      nameFr: `${montantName.fr} (entraxe ${input.montantsSpacingCm}cm)`,
      nameAr: montantName.ar,
      qty: montantsQty,
      unit: 'pièces 3m',
      unitPriceTnd: montantPrice,
      totalTnd: montantsQty * montantPrice,
      category: 'Ossature',
      packageInfo: `${montantsQty} barres de 3m (${studWidth})`,
      formulaUsed: `(${montantsPerLine} montants × ${input.heightOrWidth}m) / 3.0`
    });

    // Vis TRPF pour ossature
    const trpfPrice = getPrice('vis_trpf') || 26.0;
    const trpfBoxes = Math.max(1, Math.ceil((montantsQty * 4) / 1000));
    items.push({
      id: 'vis_trpf',
      nameFr: 'Vis TRPF Métal-Métal (Boîte 1000)',
      nameAr: 'براغي هيكل معدني TRPF (1000)',
      qty: trpfBoxes,
      unit: 'boîte 1000',
      unitPriceTnd: trpfPrice,
      totalTnd: trpfBoxes * trpfPrice,
      category: 'Fixations',
      packageInfo: `${trpfBoxes} boîte de 1000 vis TRPF`,
      formulaUsed: `Sertissage & fixation montants/rails`
    });

    const visPrice = getPrice('vis_placo_25');
    const visBoxes = Math.max(1, Math.ceil((netArea * 15 * skinFactor) / 1000));
    items.push({
      id: 'vis_placo_25',
      nameFr: 'Vis Placo TTPC 25mm (Boîte 1000)',
      nameAr: 'علبة براغي vis placo 25mm',
      qty: visBoxes,
      unit: 'boîte 1000',
      unitPriceTnd: visPrice,
      totalTnd: visBoxes * visPrice,
      category: 'Fixations',
      packageInfo: `${visBoxes} boîte(s) de 1000 vis`,
      formulaUsed: `(${netArea.toFixed(1)}m² × 15 × ${skinFactor}) / 1000`
    });

    const enduitPrice = getPrice('enduit_joint_25kg');
    const enduitKg = netArea * 1.2 * (skinFactor / 2);
    const enduitSacs = Math.max(1, Math.ceil(enduitKg / 25));
    items.push({
      id: 'enduit_joint_25kg',
      nameFr: 'Enduit de Jointage 25kg',
      nameAr: 'معجون مفاصل 25كغ',
      qty: enduitSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: enduitPrice,
      totalTnd: enduitSacs * enduitPrice,
      category: 'Finition',
      packageInfo: `${enduitSacs} sac(s) de 25kg`,
      formulaUsed: `${enduitKg.toFixed(1)} kg d'enduit`
    });

    const bandePrice = getPrice('bande_a_joint_90m');
    const bandeRouleaux = Math.max(1, Math.ceil((netArea * 1.1 * (skinFactor / 2)) / 90));
    items.push({
      id: 'bande_a_joint_90m',
      nameFr: 'Bande à Joint Papier (Rouleau 90m)',
      nameAr: 'شريط مفاصل ورقي 90م',
      qty: bandeRouleaux,
      unit: 'rouleau 90m',
      unitPriceTnd: bandePrice,
      totalTnd: bandeRouleaux * bandePrice,
      category: 'Finition',
      packageInfo: `${bandeRouleaux} rouleau(x) de 90m`,
      formulaUsed: `Joints verticaux et aboutages`
    });

    if (input.withInsulation) {
      const lainePrice = getPrice('laine_de_verre_50mm');
      const laineRolls = Math.max(1, Math.ceil((netArea * wasteFactor) / 15.0));
      items.push({
        id: 'laine_de_verre_50mm',
        nameFr: 'Laine de Verre 50mm (Rouleau 15m²)',
        nameAr: 'صوف زجاجي 50ملم (رول 15m²)',
        qty: laineRolls,
        unit: 'rouleaux 15m²',
        unitPriceTnd: lainePrice,
        totalTnd: laineRolls * lainePrice,
        category: 'Isolation',
        packageInfo: `${laineRolls} rouleau(x) de 15m²`,
        formulaUsed: `(${netArea.toFixed(1)}m² × ${wasteFactor.toFixed(2)}) / 15.0`
      });

      const bandeResilientePrice = getPrice('bande_resiliente_48mm') || 25.0;
      const bandeResilienteRolls = Math.max(1, Math.ceil((input.length * 2) / 30));
      items.push({
        id: 'bande_resiliente_48mm',
        nameFr: 'Bande Résiliente Acoustique 48mm (Rouleau 30m)',
        nameAr: 'شريط عازل تحت الهيكل المعدني 30م',
        qty: bandeResilienteRolls,
        unit: 'rouleaux 30m',
        unitPriceTnd: bandeResilientePrice,
        totalTnd: bandeResilienteRolls * bandeResilientePrice,
        category: 'Isolation',
        packageInfo: `${bandeResilienteRolls} rouleau(x) de 30m`,
        formulaUsed: `Sous rails sol et plafond`
      });
    }

    fieldNotes.push(`Montants posés tous les ${input.montantsSpacingCm}cm avec sertissage ou vis TRPF aux rails.`);
    fieldNotes.push('Pour les baies de portes, doublez les montants en vis-à-vis pour rigidifier le châssis.');

  } else if (input.subType === 'plafond_demontable') {
    executionSteps = [
      'Traçage au cordeau laser du plan horizontal sous plafond.',
      'Fixation de la cornière de rive L périphérique tous les 30-40cm.',
      'Implantation des chevilles laiton et tiges filetées M6 espacées de 1.20m.',
      'Accrochage des porteurs principaux T24 3.60m tous les 1.20m.',
      'Clipsage des entretoises transversales 1.20m au pas de 60cm.',
      'Clipsage des petites entretoises 0.60m pour fermer la trame carrée 600x600mm.',
      'Pose minutieuse avec gants propres des dalles démontables 60x60cm.'
    ];

    const dallePrice = getPrice('dalle_vinyl_60x60');
    const dallesQty = Math.ceil(netArea * 2.8 * wasteFactor);
    items.push({
      id: 'dalle_vinyl_60x60',
      nameFr: 'Dalles Vinyle 60x60 cm pour Plafond Démontable',
      nameAr: 'بلاطات فينيل 60×60 سم',
      qty: dallesQty,
      unit: 'dalles',
      unitPriceTnd: dallePrice,
      totalTnd: dallesQty * dallePrice,
      category: 'Dalles',
      packageInfo: `${dallesQty} dalles (${(dallesQty * 0.36).toFixed(1)}m² couverst)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 2.8 dalles/m² × ${wasteFactor.toFixed(2)}`
    });

    const porteurPrice = getPrice('porteur_3600');
    const porteursQty = Math.ceil(netArea * 0.23);
    items.push({
      id: 'porteur_3600',
      nameFr: 'Porteur T24 3.60m',
      nameAr: 'حامل رئيسي Porteur 3.6m',
      qty: porteursQty,
      unit: 'pièces 3.6m',
      unitPriceTnd: porteurPrice,
      totalTnd: porteursQty * porteurPrice,
      category: 'Grille',
      packageInfo: `${porteursQty} barres de 3.60m`,
      formulaUsed: `${netArea.toFixed(1)}m² × 0.23`
    });

    const entretoise12Price = getPrice('entretoise_1200');
    const entretoise12Qty = Math.ceil(netArea * 1.4);
    items.push({
      id: 'entretoise_1200',
      nameFr: 'Entretoise T24 1.20m',
      nameAr: 'عريضة Entretoise 1.2m',
      qty: entretoise12Qty,
      unit: 'pièces 1.2m',
      unitPriceTnd: entretoise12Price,
      totalTnd: entretoise12Qty * entretoise12Price,
      category: 'Grille',
      packageInfo: `${entretoise12Qty} pièces de 1.20m`,
      formulaUsed: `${netArea.toFixed(1)}m² × 1.4`
    });

    const entretoise06Price = getPrice('entretoise_600');
    const entretoise06Qty = Math.ceil(netArea * 1.4);
    items.push({
      id: 'entretoise_600',
      nameFr: 'Entretoise T24 0.60m',
      nameAr: 'عريضة Entretoise 0.6m',
      qty: entretoise06Qty,
      unit: 'pièces 0.6m',
      unitPriceTnd: entretoise06Price,
      totalTnd: entretoise06Qty * entretoise06Price,
      category: 'Grille',
      packageInfo: `${entretoise06Qty} pièces de 0.60m`,
      formulaUsed: `${netArea.toFixed(1)}m² × 1.4`
    });

    const cornierePrice = getPrice('corniere_rive_L');
    const cornieresQty = Math.ceil(perimeter / 3.0);
    items.push({
      id: 'corniere_rive_L',
      nameFr: 'Cornière de Rive L 3m',
      nameAr: 'زاوية حافة Cornière L',
      qty: cornieresQty,
      unit: 'pièces 3m',
      unitPriceTnd: cornierePrice,
      totalTnd: cornieresQty * cornierePrice,
      category: 'Grille',
      packageInfo: `${cornieresQty} barres de 3m`,
      formulaUsed: `Périmètre ${perimeter.toFixed(1)}m / 3.0`
    });

    const tigePrice = getPrice('tige_filetee_1m') || 3.0;
    const tigesQty = Math.ceil(netArea * 0.7);
    items.push({
      id: 'tige_filetee_1m',
      nameFr: 'Tiges Filetées M6 1m + Cavaliers / Suspentes',
      nameAr: 'ساق مسننة مع كافالييه للتعليق',
      qty: tigesQty,
      unit: 'pièces',
      unitPriceTnd: tigePrice,
      totalTnd: tigesQty * tigePrice,
      category: 'Accessoires',
      packageInfo: `${tigesQty} ensembles tige + cavalier`,
      formulaUsed: `${netArea.toFixed(1)}m² × 0.7`
    });

    fieldNotes.push('Maille standard 600x600mm. Vérifiez le niveau laser avant d’accrocher les porteurs.');

  } else if (input.subType === 'doublage_colle') {
    executionSteps = [
      'Nettoyage, dépoussiérage et humidification du mur support en brique ou béton.',
      'Gâchage de la colle gypse MAP à l\'eau propre (consistance pâteuse sans grumeaux).',
      'Dépose de plots de colle gypse au dos des plaques BA13 (entraxe 30cm en quinconce).',
      'Pose de la plaque contre le mur avec cale de 1cm au sol.',
      'Dressage à la règle de maçon de 2m pour assurer une planéité parfaite.',
      'Fixation de clous de sécurité tous les 100m² si hauteur > 2.50m.',
      'Jointoiement en 3 passes avec ruban à joint et ponçage.'
    ];

    const boardPrice = getPrice('plaque_ba13_standard');
    const boardsCount = Math.ceil((netArea * wasteFactor) / 3.0);
    items.push({
      id: 'plaque_ba13_standard',
      nameFr: 'Plaque BA13 Standard (3m²)',
      nameAr: 'لوح جبس BA13 عادي',
      qty: boardsCount,
      unit: 'pièces',
      unitPriceTnd: boardPrice,
      totalTnd: boardsCount * boardPrice,
      category: 'Plaques',
      packageInfo: `${boardsCount} plaques de 3m²`,
      formulaUsed: `(${netArea.toFixed(1)}m² × ${wasteFactor.toFixed(2)}) / 3.0`
    });

    const collePrice = getPrice('colle_gypse_25kg');
    const colleSacs = Math.max(1, Math.ceil((netArea * 2.5) / 25));
    items.push({
      id: 'colle_gypse_25kg',
      nameFr: 'Colle Gypse Doublage MAP (Sac 25kg)',
      nameAr: 'غراء جبس للدوبلاج (25 كغ)',
      qty: colleSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: collePrice,
      totalTnd: colleSacs * collePrice,
      category: 'Colle',
      packageInfo: `${colleSacs} sac(s) de 25kg (${(netArea * 2.5).toFixed(1)} kg)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 2.5 kg/m²`
    });

    const enduitPrice = getPrice('enduit_joint_25kg');
    const enduitSacs = Math.max(1, Math.ceil((netArea * 0.8) / 25));
    items.push({
      id: 'enduit_joint_25kg',
      nameFr: 'Enduit de Jointage 25kg',
      nameAr: 'معجون مفاصل 25كغ',
      qty: enduitSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: enduitPrice,
      totalTnd: enduitSacs * enduitPrice,
      category: 'Finition',
      packageInfo: `${enduitSacs} sac(s)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 0.8 kg/m²`
    });

    fieldNotes.push('Application de plots de colle gypse tous les 30cm au dos de la plaque.');

  } else if (input.subType === 'aquapanel_exterieur') {
    executionSteps = [
      'Structure métallique renforcée avec entraxe réduit à 40cm maximum.',
      'Pose des plaques ciment Aquapanel avec jeu de 3-4mm entre plaques.',
      'Vissage à pas de 25cm avec vis spécifiques anticorrosion Aquapanel.',
      'Application de la première couche de colle ciment armée.',
      'Marouflage de la trame en fibre de verre résistante aux alcalis avec recouvrement de 10cm.',
      'Application de la deuxième couche de lissage colle ciment.',
      'Application de l\'enduit de finition de façade.'
    ];

    const aquaPrice = getPrice('plaque_aquapanel_ciment');
    const aquaCount = Math.ceil((netArea * wasteFactor) / 2.88);
    items.push({
      id: 'plaque_aquapanel_ciment',
      nameFr: 'Plaque Aquapanel Ciment Extérieur (2.88m²)',
      nameAr: 'لوح إسمنتي ألواباك Aquapanel',
      qty: aquaCount,
      unit: 'pièces',
      unitPriceTnd: aquaPrice,
      totalTnd: aquaCount * aquaPrice,
      category: 'Plaques',
      packageInfo: `${aquaCount} plaques de 1.20m x 2.40m`,
      formulaUsed: `(${netArea.toFixed(1)}m² × ${wasteFactor.toFixed(2)}) / 2.88`
    });

    const visPrice = getPrice('vis_aquapanel');
    const visBoxes = Math.max(1, Math.ceil((netArea * 20) / 500));
    items.push({
      id: 'vis_aquapanel',
      nameFr: 'Vis Inox Aquapanel (Boîte 500)',
      nameAr: 'علبة براغي إينوكس 500',
      qty: visBoxes,
      unit: 'boîte 500',
      unitPriceTnd: visPrice,
      totalTnd: visBoxes * visPrice,
      category: 'Fixations',
      packageInfo: `${visBoxes} boîte(s) de 500 vis inox`,
      formulaUsed: `(${netArea.toFixed(1)}m² × 20 vis/m²) / 500`
    });

    const collePrice = getPrice('colle_ciment_exterieur_25kg');
    const colleSacs = Math.max(1, Math.ceil((netArea * 3.5) / 25));
    items.push({
      id: 'colle_ciment_exterieur_25kg',
      nameFr: 'Colle Ciment Extérieur (Sac 25kg)',
      nameAr: 'إسمنت لاصق خارجي 25كغ',
      qty: colleSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: collePrice,
      totalTnd: colleSacs * collePrice,
      category: 'Enduit',
      packageInfo: `${colleSacs} sac(s) de 25kg (${(netArea * 3.5).toFixed(1)} kg)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 3.5 kg/m²`
    });

    const tramePrice = getPrice('trame_fibre_exterieur') || 45.0;
    const trameRolls = Math.max(1, Math.ceil((netArea * 1.10) / 50));
    items.push({
      id: 'trame_fibre_exterieur',
      nameFr: 'Trame de Renfort Fibre de Verre (Rouleau 50m)',
      nameAr: 'شبكة ألياف تسليح خارجية (50م)',
      qty: trameRolls,
      unit: 'rouleau 50m',
      unitPriceTnd: tramePrice,
      totalTnd: trameRolls * tramePrice,
      category: 'Armature',
      packageInfo: `${trameRolls} rouleau(x) de 50m`,
      formulaUsed: `(${netArea.toFixed(1)}m² × 1.10) / 50m`
    });

    fieldNotes.push('Utilisez la trame en fibre de verre résistante aux alcalis sur toute la surface.');

  } else if (input.subType === 'caisson_retombee') {
    executionSteps = [
      'Tracé du tracé périphérique du caisson au laser (sol/plafond).',
      'Fixation des rails hauts au plafond existant.',
      'Assemblage de l\'ossature verticale (retombée) et horizontale (soffite).',
      input.withGorgeLumineuse ? 'Montage de la gorge lumineuse relevée (8 à 10cm) pour le bandeau LED.' : 'Rigidification des angles par cornières renforcées.',
      'Habillage des faces en BA13 avec vis TTPC 25mm.',
      'Pose des cornières d\'angle perforées sur toutes les arêtes vives.',
      'Enduisage soigné en 3 passes et ponçage minutieux des angles.'
    ];

    const linearM = input.length;
    const retH = (input.caissonHeightCm || 20) / 100;
    const sofW = (input.caissonWidthCm || 40) / 100;
    const gorgeH = input.withGorgeLumineuse ? 0.10 : 0;
    const devWidth = retH + sofW + gorgeH;
    const devArea = linearM * devWidth;

    const boardPrice = getPrice(input.boardType);
    const boardNames = getName(input.boardType);
    const boardsCount = Math.max(1, Math.ceil((devArea * wasteFactor) / 3.0));
    items.push({
      id: input.boardType,
      nameFr: `${boardNames.fr} (Surface dev. ${devArea.toFixed(1)}m²)`,
      nameAr: `${boardNames.ar} (مساحة منبسطة ${devArea.toFixed(1)}م²)`,
      qty: boardsCount,
      unit: 'pièces (3m²)',
      unitPriceTnd: boardPrice,
      totalTnd: boardsCount * boardPrice,
      category: 'Plaques',
      packageInfo: `${boardsCount} plaques`,
      formulaUsed: `${linearM}ml × ${devWidth.toFixed(2)}m larg. dev. / 3.0`
    });

    const railPrice = getPrice('rail_48');
    const railsQty = Math.ceil((linearM * (input.withGorgeLumineuse ? 4 : 3)) / 3.0);
    items.push({
      id: 'rail_48',
      nameFr: `Rail 48mm 3m (${input.withGorgeLumineuse ? '4 lignes pour caisson + gorge' : '3 lignes pour caisson'})`,
      nameAr: 'قضيب Rail 48 لهيكل الكرتوش',
      qty: railsQty,
      unit: 'pièces 3m',
      unitPriceTnd: railPrice,
      totalTnd: railsQty * railPrice,
      category: 'Ossature',
      packageInfo: `${railsQty} barres de 3m`,
      formulaUsed: `(${linearM}ml × ${input.withGorgeLumineuse ? 4 : 3}) / 3.0`
    });

    const fourrurePrice = getPrice('fourrure');
    const fourruresQty = Math.ceil((linearM * 2.0) / 3.0);
    items.push({
      id: 'fourrure',
      nameFr: 'Fourrure F47 / Renforts de caisson',
      nameAr: 'Fourrure F47 لتقوية الكرتوش',
      qty: fourruresQty,
      unit: 'pièces 3m',
      unitPriceTnd: fourrurePrice,
      totalTnd: fourruresQty * fourrurePrice,
      category: 'Ossature',
      packageInfo: `${fourruresQty} barres de 3m`,
      formulaUsed: `(${linearM}ml × 2.0) / 3.0`
    });

    const cornierePrice = getPrice('corniere_angle');
    const cornieresQty = Math.ceil((linearM * (input.withGorgeLumineuse ? 3 : 2)) / 3.0);
    items.push({
      id: 'corniere_angle',
      nameFr: 'Cornière d’Angle / Renfort d’arête 3m',
      nameAr: 'زوايا معدنية لحماية حواف الكرتوش',
      qty: cornieresQty,
      unit: 'pièces 3m',
      unitPriceTnd: cornierePrice,
      totalTnd: cornieresQty * cornierePrice,
      category: 'Finition',
      packageInfo: `${cornieresQty} barres de 3m`,
      formulaUsed: `(${linearM}ml × ${input.withGorgeLumineuse ? 3 : 2}) / 3.0`
    });

    const visPrice = getPrice('vis_placo_25');
    const visBoxes = Math.max(1, Math.ceil((linearM * 25) / 1000));
    items.push({
      id: 'vis_placo_25',
      nameFr: 'Vis Placo TTPC 25mm (Boîte 1000)',
      nameAr: 'علبة براغي vis placo 25mm',
      qty: visBoxes,
      unit: 'boîte 1000',
      unitPriceTnd: visPrice,
      totalTnd: visBoxes * visPrice,
      category: 'Fixations',
      packageInfo: `${visBoxes} boîte de 1000 vis`,
      formulaUsed: `(${linearM}ml × 25) / 1000`
    });

    const enduitPrice = getPrice('enduit_joint_25kg');
    const enduitSacs = Math.max(1, Math.ceil((devArea * 1.5) / 25));
    items.push({
      id: 'enduit_joint_25kg',
      nameFr: 'Enduit de Jointage et Finition 25kg',
      nameAr: 'معجون مفاصل 25كغ',
      qty: enduitSacs,
      unit: 'sacs 25kg',
      unitPriceTnd: enduitPrice,
      totalTnd: enduitSacs * enduitPrice,
      category: 'Finition',
      packageInfo: `${enduitSacs} sac(s) de 25kg`,
      formulaUsed: `${devArea.toFixed(1)}m² × 1.5 kg/m²`
    });

    fieldNotes.push(`Calcul au Mètre Linéaire: ${linearM}ml avec retombée de ${input.caissonHeightCm || 20}cm et soffite de ${input.caissonWidthCm || 40}cm.`);
    if (input.withGorgeLumineuse) {
      fieldNotes.push('Gorge lumineuse pour bandeau LED intégrée (relevé de 8 à 10cm).');
    }
    fieldNotes.push('Pose recommandée de cornières perforées d’arêtes pour des bordures parfaitement rectilignes.');

  } else if (input.subType === 'arc_forme_complexe') {
    executionSteps = [
      'Tracé du rayon de courbure sur gabarit ou directement au sol.',
      'Crantage au ciseau à tôle des ailes des rails tous les 5cm pour former le rayon.',
      'Fixation de l\'ossature cintrée sur montants et suspentes renforcées.',
      'Humidification légère ou pré-cintrage des bandes de plaques BA13 ou BA6.',
      'Vissage progressif du centre vers les extrémités de l\'arc.',
      'Pose de profilés souples de finition ou armatures flexibles.',
      'Enduisage soigné en passes successives pour obtenir une courbe parfaite.'
    ];

    const arcsQty = input.arcCount || 1;
    const boardPrice = getPrice(input.boardType);
    const boardNames = getName(input.boardType);
    const boardsCount = Math.max(2, Math.ceil((netArea * wasteFactor) / 3.0) * arcsQty);
    items.push({
      id: input.boardType,
      nameFr: `${boardNames.fr} (Arcs et cintrage)`,
      nameAr: `${boardNames.ar} (للأقواس والقص الدائري)`,
      qty: boardsCount,
      unit: 'pièces',
      unitPriceTnd: boardPrice,
      totalTnd: boardsCount * boardPrice,
      category: 'Plaques',
      packageInfo: `${boardsCount} plaques`,
      formulaUsed: `Forfait courbures & découpes`
    });

    const railPrice = getPrice('rail_48');
    const railsQty = Math.max(2, Math.ceil((input.length * 3) / 3.0));
    items.push({
      id: 'rail_48',
      nameFr: 'Rail 48mm cintrable / cranté',
      nameAr: 'قضيب Rail 48 مقصوص للأقواس',
      qty: railsQty,
      unit: 'pièces 3m',
      unitPriceTnd: railPrice,
      totalTnd: railsQty * railPrice,
      category: 'Ossature',
      packageInfo: `${railsQty} barres de 3m crantées`,
      formulaUsed: `Rayon de courbure`
    });

    const visPrice = getPrice('vis_placo_25');
    items.push({
      id: 'vis_placo_25',
      nameFr: 'Vis Placo TTPC 25mm (Boîte 1000)',
      nameAr: 'علبة براغي vis placo 25mm',
      qty: 1,
      unit: 'boîte 1000',
      unitPriceTnd: visPrice,
      totalTnd: visPrice,
      category: 'Fixations',
      packageInfo: `1 boîte de 1000`,
      formulaUsed: `Fixation courbes`
    });

    const enduitPrice = getPrice('enduit_joint_25kg');
    items.push({
      id: 'enduit_joint_25kg',
      nameFr: 'Enduit de Jointage 25kg (Finition courbes)',
      nameAr: 'معجون تشطيب الأقواس 25كغ',
      qty: 1,
      unit: 'sac 25kg',
      unitPriceTnd: enduitPrice,
      totalTnd: enduitPrice,
      category: 'Finition',
      packageInfo: `1 sac de 25kg`,
      formulaUsed: `Finition cintrée`
    });

    fieldNotes.push(`Tarification au Forfait conventionnelle: ${arcsQty} arc(s)/forme(s) complexe(s).`);
    fieldNotes.push('Nécessite le crantage au ciseau à tôle des rails tous les 5cm pour former le rayon de courbure.');
  }

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  
  let estimatedLaborTnd = 0;
  if (input.subType === 'caisson_retombee') {
    estimatedLaborTnd = Math.round(input.length * (input.laborRatePerM2 || 22));
  } else if (input.subType === 'arc_forme_complexe') {
    estimatedLaborTnd = input.forfaitPriceTnd || ((input.arcCount || 1) * 140);
  } else {
    estimatedLaborTnd = Math.round(netArea * input.laborRatePerM2);
  }

  const subTypeTitles: Record<string, string> = {
    faux_plafond_ba13: 'Faux Plafond Simple BA13',
    cloison_fixe: 'Cloison de Séparation BA13',
    doublage_colle: 'Doublage Collé BA13',
    plafond_demontable: 'Plafond Démontable 60x60',
    aquapanel_exterieur: 'Habillage Aquapanel Extérieur',
    caisson_retombee: `Caisson & Retombée (${input.length}ml - الكرتوش)`,
    arc_forme_complexe: `Arcs & Décoration Forfait (${input.arcCount || 1} Arcs)`
  };

  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'placo',
    subType: input.subType,
    subTypeTitle: subTypeTitles[input.subType] || input.subType.replace(/_/g, ' ').toUpperCase(),
    areaM2: grossArea,
    netAreaM2: netArea,
    perimeterM: perimeter,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes,
    executionSteps,
    ...fiscal
  };
}

// PART 3 - PEINTURE
export function calculatePeinture(input: PeintureInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  
  const grossArea = input.length * input.height;
  const netArea = Math.max(0, grossArea - input.openingsArea);
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  let surfaceMult = 1.0;
  if (input.surfaceCondition === 'normal') surfaceMult = 1.15;
  if (input.surfaceCondition === 'rough') surfaceMult = 1.35;

  const effectiveRendement = input.rendementM2L / surfaceMult;
  const totalLitres = Math.ceil(((netArea / effectiveRendement) * input.coats) * wasteFactor);
  const seaux10L = Math.max(1, Math.ceil(totalLitres / 10));

  const items: MaterialItemResult[] = [];
  const paintPrice = getPrice(input.paintType);
  const paintNameFr = rates.find(r => r.id === input.paintType)?.nameFr || 'Peinture (Seau 10L)';
  const paintNameAr = rates.find(r => r.id === input.paintType)?.nameAr || 'دهان (سطال 10L)';

  items.push({
    id: input.paintType,
    nameFr: `${paintNameFr} (${seaux10L * 10} Litres calculés)`,
    nameAr: `${paintNameAr}`,
    qty: seaux10L,
    unit: 'seaux 10L',
    unitPriceTnd: paintPrice,
    totalTnd: seaux10L * paintPrice,
    category: 'Peinture',
    packageInfo: `${seaux10L} seau(x) de 10L (${totalLitres}L théoriques pour ${input.coats} couches)`,
    formulaUsed: `(${netArea.toFixed(1)}m² / ${effectiveRendement.toFixed(1)} m²/L) × ${input.coats} couches × ${wasteFactor.toFixed(2)}`
  });

  const primerLitres = Math.ceil((netArea / 11) * 1.10);
  const primerSeaux = Math.max(1, Math.ceil(primerLitres / 10));
  const primerPrice = getPrice('impression_primer_10l') || 48.0;
  items.push({
    id: 'impression_primer_10l',
    nameFr: 'Impression / Primer Fixateur (Seau 10L)',
    nameAr: 'طلاء أساسي بريمر 10L',
    qty: primerSeaux,
    unit: 'seaux 10L',
    unitPriceTnd: primerPrice,
    totalTnd: primerSeaux * primerPrice,
    category: 'Sous-couche',
    packageInfo: `${primerSeaux} seau(x) de 10L (${primerLitres}L calculés)`,
    formulaUsed: `${netArea.toFixed(1)}m² / 11 m²/L`
  });

  const enduitKg = Math.round(netArea * 1.5);
  const enduitSacs = Math.max(1, Math.ceil(enduitKg / 25));
  const enduitPrice = getPrice('enduit_joint_25kg');
  items.push({
    id: 'enduit_joint_25kg',
    nameFr: 'Enduit de Lissage / Rebouchage (Sac 25kg)',
    nameAr: 'معجون تحضير الأسطح (كيس 25كغ)',
    qty: enduitSacs,
    unit: 'sacs 25kg',
    unitPriceTnd: enduitPrice,
    totalTnd: enduitSacs * enduitPrice,
    category: 'Préparation',
    packageInfo: `${enduitSacs} sac(s) de 25kg (${enduitKg}kg)`,
    formulaUsed: `${netArea.toFixed(1)}m² × 1.5 kg/m²`
  });

  const rubanPrice = 4.5;
  const rubanQty = Math.max(1, Math.ceil(((input.length + input.height) * 2) / 50));
  items.push({
    id: 'ruban_masquage',
    nameFr: 'Ruban de Masquage Scotch Papier (Rouleau 50m)',
    nameAr: 'شريط لاصق للحماية 50م',
    qty: rubanQty,
    unit: 'rouleau 50m',
    unitPriceTnd: rubanPrice,
    totalTnd: rubanQty * rubanPrice,
    category: 'Protection',
    packageInfo: `${rubanQty} rouleau(x) de 50m`,
    formulaUsed: `Protection plinthes et angles`
  });

  const bachePrice = 9.0;
  const bacheQty = Math.max(1, Math.ceil(grossArea / 20));
  items.push({
    id: 'bache_protection',
    nameFr: 'Bâche Plastique de Protection Sol (20m²)',
    nameAr: 'غطاء بلاستيكي لحماية الأرضيات 20m²',
    qty: bacheQty,
    unit: 'pièces',
    unitPriceTnd: bachePrice,
    totalTnd: bacheQty * bachePrice,
    category: 'Protection',
    packageInfo: `${bacheQty} bâche(s) de 20m²`,
    formulaUsed: `${grossArea.toFixed(1)}m² / 20m²`
  });

  const executionSteps = [
    'Égrenage, dépoussiérage et dégraissage soigné du support.',
    'Application de l\'enduit de rebouchage sur les trous et fissures.',
    'Application de 2 couches croisées d\'enduit de lissage sur toute la surface.',
    'Ponçage fin au papier de verre grain 120 puis 220 pour une surface lisse miroir.',
    'Application d\'une couche d\'impression (Primer) diluée selon recommandation.',
    `Application de ${input.coats} couche(s) de finition avec respect du temps de séchage (4-6h entre couches).`
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(netArea * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'peinture',
    subType: input.paintType,
    subTypeTitle: `Peinture ${input.coats} Couche(s) (${input.surfaceCondition})`,
    areaM2: grossArea,
    netAreaM2: netArea,
    perimeterM: (input.length + input.height) * 2,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      `Rendement moyen appliqué: ${effectiveRendement.toFixed(1)} m²/L par couche.`,
      'Respecter un séchage minimal de 4 à 6 heures entre chaque couche.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 4 - CARRELAGE
export function calculateCarrelage(input: CarrelageInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const area = input.length * input.width;

  let wasteFactor = 1 + (input.wasteMarginPercent / 100);
  if (input.poseType === 'diagonale') wasteFactor += 0.05;

  const tilePrice = getPrice(input.tileType) || 32.0;
  const tileNameFr = rates.find(r => r.id === input.tileType)?.nameFr || 'Carrelage Sol m²';
  const tileNameAr = rates.find(r => r.id === input.tileType)?.nameAr || 'تبليط أرضيات م²';

  const m2WithWaste = Math.ceil(area * wasteFactor);

  const items: MaterialItemResult[] = [
    {
      id: input.tileType,
      nameFr: `${tileNameFr} (avec ${(wasteFactor * 100 - 100).toFixed(0)}% perte)`,
      nameAr: `${tileNameAr}`,
      qty: m2WithWaste,
      unit: 'm²',
      unitPriceTnd: tilePrice,
      totalTnd: m2WithWaste * tilePrice,
      category: 'Carreaux',
      packageInfo: `${m2WithWaste} m² de carreaux (${(m2WithWaste - area).toFixed(1)}m² de chutes/coupes)`,
      formulaUsed: `${area.toFixed(1)}m² × ${wasteFactor.toFixed(2)}`
    }
  ];

  const colleKg = Math.round(area * 4.5);
  const colleSacs = Math.max(1, Math.ceil(colleKg / 25));
  const collePrice = getPrice('colle_ciment_exterieur_25kg') || 25.0;
  items.push({
    id: 'colle_ciment_exterieur_25kg',
    nameFr: 'Colle Ciment C2TE Haute Adhérence (Sac 25kg)',
    nameAr: 'غراء كاريو 25كغ',
    qty: colleSacs,
    unit: 'sacs 25kg',
    unitPriceTnd: collePrice,
    totalTnd: colleSacs * collePrice,
    category: 'Colle',
    packageInfo: `${colleSacs} sac(s) de 25kg (${colleKg} kg)`,
    formulaUsed: `${area.toFixed(1)}m² × 4.5 kg/m²`
  });

  const jointKg = Math.round(area * 0.6);
  const jointPrice = 12.0;
  const jointSacs = Math.max(1, Math.ceil(jointKg / 5));
  items.push({
    id: 'joint_ciment',
    nameFr: 'Mortier à Joint Hydrofuge Souple (Sac 5kg)',
    nameAr: 'معجون مفاصل التبليط 5كغ',
    qty: jointSacs,
    unit: 'sacs 5kg',
    unitPriceTnd: jointPrice,
    totalTnd: jointSacs * jointPrice,
    category: 'Joints',
    packageInfo: `${jointSacs} sac(s) de 5kg (${jointKg} kg)`,
    formulaUsed: `${area.toFixed(1)}m² × 0.6 kg/m²`
  });

  const croisillonsPrice = 8.5;
  const croisillonsQty = Math.max(1, Math.ceil(area / 15));
  items.push({
    id: 'croisillons_carrelage',
    nameFr: 'Croisillons Autonivelants / 2mm (Boîte 250)',
    nameAr: 'صليبات تسوية التبليط (علبة 250)',
    qty: croisillonsQty,
    unit: 'boîte 250',
    unitPriceTnd: croisillonsPrice,
    totalTnd: croisillonsQty * croisillonsPrice,
    category: 'Accessoires',
    packageInfo: `${croisillonsQty} boîte(s) de 250 pièces`,
    formulaUsed: `Planéité et espacement régulier`
  });

  const plinthesPerimeter = Math.round((input.length + input.width) * 2);
  const plinthesQty = Math.ceil((plinthesPerimeter * 1.10) / 2.4);
  items.push({
    id: 'plinthes_carrelage',
    nameFr: 'Plinthes Assorties Découpées (ml)',
    nameAr: 'حواف أرضية بلانت للتبليط',
    qty: plinthesQty,
    unit: 'ml',
    unitPriceTnd: 9.0,
    totalTnd: plinthesQty * 9.0,
    category: 'Finition',
    packageInfo: `${plinthesQty} mètres linéaires de plinthes`,
    formulaUsed: `Périmètre ${plinthesPerimeter}m × 1.10`
  });

  const executionSteps = [
    'Contrôle de la planéité et de l\'humidité du support (chape ou ragréage préalable).',
    'Tracé des axes de départ au cordeau traceur (calepinage pour centrer les coupes).',
    'Gâchage de la colle ciment C2TE et application au peigne cranté de 8-10mm (double encollage si format > 40x40).',
    `Pose des carreaux avec mise en place des croisillons pour joints de 2 à 3mm (pose ${input.poseType}).`,
    'Contrôle permanent au niveau à bulle et maillet en caoutchouc.',
    'Attente de 24h pour le durcissement avant jointoiement.',
    'Remplissage des joints à la taloche caoutchouc et nettoyage à l\'éponge humide.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(area * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'carrelage',
    subType: input.tileFormat,
    subTypeTitle: `Carrelage ${input.tileFormat} (Pose ${input.poseType})`,
    areaM2: area,
    netAreaM2: area,
    perimeterM: plinthesPerimeter,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      `Pose ${input.poseType}. Prévoir des croisillons de 2mm à 3mm.`,
      'Attendre 24h après le collage avant le coulage des joints.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 5 - MAÇONNERIE
export function calculateMaconnerie(input: MaconnerieInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const grossArea = input.length * input.height;
  const netArea = Math.max(0, grossArea - input.openingsArea);
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  const items: MaterialItemResult[] = [];

  if (input.type === 'brique_12trous') {
    const unitPrice = getPrice('brique_rouge_12trous') || 0.95;
    const briquesQty = Math.ceil(netArea * 30 * wasteFactor);
    items.push({
      id: 'brique_rouge_12trous',
      nameFr: 'Briques Rouges 12 Trous (25x12x6.5cm)',
      nameAr: 'ياجورة حمراء 12 عين',
      qty: briquesQty,
      unit: 'pièces',
      unitPriceTnd: unitPrice,
      totalTnd: briquesQty * unitPrice,
      category: 'Maçonnerie',
      packageInfo: `${briquesQty} briques (${(briquesQty / 30).toFixed(1)}m² réels)`,
      formulaUsed: `${netArea.toFixed(1)}m² × 30 briques/m² × ${wasteFactor.toFixed(2)}`
    });
  } else {
    const unitPrice = getPrice('bloc_beton_20x20x40') || 1.60;
    const parpaingQty = Math.ceil(netArea * 12.5 * wasteFactor);
    items.push({
      id: 'bloc_beton_20x20x40',
      nameFr: 'Blocs Béton Parpaing 20x20x40',
      nameAr: 'بلوك خرساني باربان 20x20x40',
      qty: parpaingQty,
      unit: 'pièces',
      unitPriceTnd: unitPrice,
      totalTnd: parpaingQty * unitPrice,
      category: 'Maçonnerie',
      packageInfo: `${parpaingQty} parpaings`,
      formulaUsed: `${netArea.toFixed(1)}m² × 12.5 unités/m² × ${wasteFactor.toFixed(2)}`
    });
  }

  const cimentKg = Math.round(netArea * 12.5);
  const cimentSacs = Math.max(1, Math.ceil(cimentKg / 50));
  const cimentPrice = getPrice('sac_ciment_50kg') || 19.5;
  items.push({
    id: 'sac_ciment_50kg',
    nameFr: 'Ciment CEM II 42.5 (Sac de 50kg)',
    nameAr: 'كيس أسمنت 50 كغ',
    qty: cimentSacs,
    unit: 'sacs 50kg',
    unitPriceTnd: cimentPrice,
    totalTnd: cimentSacs * cimentPrice,
    category: 'Liant',
    packageInfo: `${cimentSacs} sac(s) de 50kg (${cimentKg} kg)`,
    formulaUsed: `${netArea.toFixed(1)}m² × 12.5 kg ciment/m²`
  });

  const sableM3 = Math.round(netArea * 0.03 * 100) / 100;
  const sablePrice = 45.0;
  items.push({
    id: 'sable_maconnerie',
    nameFr: 'Sable de Rivière pour Mortier (m³)',
    nameAr: 'رمل بناء وخلط (m³)',
    qty: Math.max(0.5, sableM3),
    unit: 'm³',
    unitPriceTnd: sablePrice,
    totalTnd: Math.max(0.5, sableM3) * sablePrice,
    category: 'Agrégats',
    packageInfo: `${Math.max(0.5, sableM3)} m³ de sable`,
    formulaUsed: `${netArea.toFixed(1)}m² × 0.03 m³/m²`
  });

  const executionSteps = [
    'Nettoyage et arrosage du sol de fondation.',
    'Pose du lit de mortier de niveau (dosage: 1 part ciment pour 3 parts sable).',
    'Pose des briques/parpaings à joints croisés en contrôlant l\'aplomb et l\'alignement au cordeau.',
    'Arrosage généreux des briques avant pose pour éviter l\'absorption de l\'eau du mortier.',
    'Coulage des linteaux en béton armé au-dessus des portes et fenêtres avec appui min de 20cm.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(netArea * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'maconnerie',
    subType: input.type,
    subTypeTitle: input.type === 'brique_12trous' ? 'Mur Brique Rouge 12 Trous' : 'Mur Parpaing Béton',
    areaM2: grossArea,
    netAreaM2: netArea,
    perimeterM: (input.length + input.height) * 2,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Humidifier les briques avant la pose.',
      'Prévoir un linteau béton armé au-dessus de chaque ouverture.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 6 - PLOMBERIE
export function calculatePlomberie(input: PlomberieInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  // Alimentation family — `pipeType` selects the technology; both reuse the
  // existing documented splits of the network (0.7 distribution / 0.3 colonne).
  if (input.pipeType === 'ppr') {
    const pprBars = Math.max(1, Math.ceil(((input.networkLengthM * 0.7) / 4) * wasteFactor));
    const pprPrice = getPrice('ppr_tube_20_4m') || 9.5;
    items.push({
      id: 'ppr_tube_20_4m',
      nameFr: 'Tube PPR 20mm Alimentation (Barres 4m)',
      nameAr: 'أنابيب PPR 20 ملم (قضيب 4 أمتار)',
      qty: pprBars,
      unit: 'barres 4m',
      unitPriceTnd: pprPrice,
      totalTnd: pprBars * pprPrice,
      category: 'Tuyauterie',
      packageInfo: `${pprBars} barres de 4m (${pprBars * 4}m)`,
      formulaUsed: `(${input.networkLengthM}m × 0.7 × ${wasteFactor.toFixed(2)}) / 4`
    });

    const ppr25Bars = Math.max(1, Math.ceil(((input.networkLengthM * 0.3) / 4) * wasteFactor));
    const ppr25Price = getPrice('ppr_tube_25_4m') || 14.0;
    items.push({
      id: 'ppr_tube_25_4m',
      nameFr: 'Tube PPR 25mm Colonne Principale (Barres 4m)',
      nameAr: 'أنابيب PPR 25 ملم كولون رئيسي',
      qty: ppr25Bars,
      unit: 'barres 4m',
      unitPriceTnd: ppr25Price,
      totalTnd: ppr25Bars * ppr25Price,
      category: 'Tuyauterie',
      packageInfo: `${ppr25Bars} barres de 4m`,
      formulaUsed: `(${input.networkLengthM}m × 0.3) / 4`
    });
  } else if (input.pipeType === 'multicouche') {
    const mc20Bars = Math.max(1, Math.ceil(((input.networkLengthM * 0.7) / 4) * wasteFactor));
    const mc20Price = getPrice('multicouche_tube_20_4m') || 11.0;
    items.push({
      id: 'multicouche_tube_20_4m',
      nameFr: 'Tube Multicouche Alu-PEX 20mm (Barres 4m)',
      nameAr: 'أنابيب متعدد الطبقات 20 ملم (قضيب 4 أمتار)',
      qty: mc20Bars,
      unit: 'barres 4m',
      unitPriceTnd: mc20Price,
      totalTnd: mc20Bars * mc20Price,
      category: 'Tuyauterie',
      packageInfo: `${mc20Bars} barres de 4m (${mc20Bars * 4}m)`,
      formulaUsed: `(${input.networkLengthM}m × 0.7 × ${wasteFactor.toFixed(2)}) / 4`
    });

    const mc25Bars = Math.max(1, Math.ceil(((input.networkLengthM * 0.3) / 4) * wasteFactor));
    const mc25Price = getPrice('multicouche_tube_25_4m') || 16.0;
    items.push({
      id: 'multicouche_tube_25_4m',
      nameFr: 'Tube Multicouche Alu-PEX 25mm (Barres 4m)',
      nameAr: 'أنابيب متعدد الطبقات 25 ملم (قضيب 4 أمتار)',
      qty: mc25Bars,
      unit: 'barres 4m',
      unitPriceTnd: mc25Price,
      totalTnd: mc25Bars * mc25Price,
      category: 'Tuyauterie',
      packageInfo: `${mc25Bars} barres de 4m`,
      formulaUsed: `(${input.networkLengthM}m × 0.3) / 4`
    });
  }

  // Évacuation family — PVC rigide always part of a sanitaire job (KB PART 6);
  // wasteFactor now applied consistently with the alimentation lines (same base
  // equation: ×0.5 lavabos/douches + ×0.3 WC, divided by 4m bars).
  const pvc40Bars = Math.max(1, Math.ceil(((input.networkLengthM * 0.5) / 4) * wasteFactor));
  const pvc40Price = getPrice('pvc_tube_40_4m') || 9.0;
  items.push({
    id: 'pvc_tube_40_4m',
    nameFr: 'Tube PVC Évacuation 40mm (Barres 4m)',
    nameAr: 'أنابيب PVC تصريف 40 ملم',
    qty: pvc40Bars,
    unit: 'barres 4m',
    unitPriceTnd: pvc40Price,
    totalTnd: pvc40Bars * pvc40Price,
    category: 'Évacuation',
    packageInfo: `${pvc40Bars} barres de 4m`,
    formulaUsed: `Évacuation lavabos/douches`
  });

  const pvc110Bars = Math.max(1, Math.ceil(((input.networkLengthM * 0.3) / 4) * wasteFactor));
  items.push({
    id: 'pvc_tube_110_4m',
    nameFr: 'Tube PVC Évacuation 110mm WC (Barres 4m)',
    nameAr: 'أنابيب PVC تصريف 110 ملم (قضيب 4م)',
    qty: pvc110Bars,
    unit: 'barres 4m',
    unitPriceTnd: 24.0,
    totalTnd: pvc110Bars * 24.0,
    category: 'Évacuation',
    packageInfo: `${pvc110Bars} barres de 4m`,
    formulaUsed: `Collecteurs principaux WC`
  });

  // Fittings follow the pipeType technology — same documented formula
  // (points × 4 + réseau; KB: ~3 à 4 raccords par mètre linéaire).
  if (input.pipeType === 'ppr') {
    const raccordsQty = Math.ceil(input.pointsCount * 4 + input.networkLengthM * 1.2);
    const raccordPrice = getPrice('raccord_ppr_coude_te') || 1.8;
    items.push({
      id: 'raccord_ppr_coude_te',
      nameFr: 'Raccords PPR Coudes / Tés / Manchons',
      nameAr: 'أكواع وتوصيلات PPR للتلحيم',
      qty: raccordsQty,
      unit: 'pièces',
      unitPriceTnd: raccordPrice,
      totalTnd: raccordsQty * raccordPrice,
      category: 'Raccords',
      packageInfo: `${raccordsQty} raccords divers`,
      formulaUsed: `${input.pointsCount} points × 4 + réseau`
    });
  } else if (input.pipeType === 'multicouche') {
    const raccordsQty = Math.ceil(input.pointsCount * 4 + input.networkLengthM * 1.2);
    const raccordPrice = getPrice('raccord_multicouche_sertir') || 2.5;
    items.push({
      id: 'raccord_multicouche_sertir',
      nameFr: 'Raccords Multicouche à Sertir (Corps + Anneaux)',
      nameAr: 'وصلات متعدد الطبقات بالكبس',
      qty: raccordsQty,
      unit: 'pièces',
      unitPriceTnd: raccordPrice,
      totalTnd: raccordsQty * raccordPrice,
      category: 'Raccords',
      packageInfo: `${raccordsQty} raccords divers`,
      formulaUsed: `${input.pointsCount} points × 4 + réseau`
    });
  }

  const collePrice = getPrice('colle_pvc_pot') || 11.0;
  items.push({
    id: 'colle_pvc_pot',
    nameFr: 'Colle PVC Pression 250g + Décapant',
    nameAr: 'غراء أنابيب PVC علبة 250غ',
    qty: 1,
    unit: 'boîte',
    unitPriceTnd: collePrice,
    totalTnd: collePrice,
    category: 'Consommables',
    packageInfo: `1 pot de 250g`,
    formulaUsed: `Collage évacuations`
  });

  // Téflon = threaded joints of the alimentation network — not needed on a
  // pure PVC évacuation (glued) job, so it follows the alimentation types.
  if (input.pipeType !== 'pvc_evac') {
    const teflonPrice = 1.5;
    items.push({
      id: 'teflon_ptfe',
      nameFr: 'Ruban Téflon PTFE Étanchéité Filetée (Lot de 3)',
      nameAr: 'شريط تيفلون عازل',
      qty: 3,
      unit: 'pièces',
      unitPriceTnd: teflonPrice,
      totalTnd: 3 * teflonPrice,
      category: 'Consommables',
      packageInfo: `3 rouleaux Téflon`,
      formulaUsed: `Étanchéité raccords filetés`
    });
  }

  const executionSteps = [
    'Traçage et réalisation des saignées murales et au sol.',
    'Soudure polyfusion des tubes PPR à 260°C avec contrôle de l\'alignement.',
    'Pose des gaines de protection thermo-acoustiques sur les tuyaux encastrés.',
    'Assemblage et collage des canalisations PVC avec respect d\'une pente minimale de 1.5 à 2cm/m.',
    'Test obligatoire sous pression à 6 bars pendant 12 heures avant rebouchage des saignées.',
    'Pose des robinetteries, nourrices et bondes avec joints d\'étanchéité.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.pointsCount * input.laborRatePerPoint);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'plomberie',
    subType: input.pipeType,
    subTypeTitle: `Plomberie Sanitaire (${input.pointsCount} Points d'eau)`,
    areaM2: input.networkLengthM,
    netAreaM2: input.networkLengthM,
    perimeterM: input.networkLengthM,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Test sous pression à 6 bars pendant 12 heures obligatoire avant rebouchage.',
      'Soudure PPR à température contrôlée de 260°C (temps de chauffe 5-7 sec).'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 7 - ÉLECTRICITÉ
export function calculateElectricite(input: ElectriciteInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];
  const totalPoints = input.lightPointsCount + input.powerOutletsCount + input.forceLinesCount;

  const rouleaux1_5 = Math.max(1, Math.ceil((input.lightPointsCount * 18) / 100));
  const cable1_5Price = getPrice('cable_1_5mm_100m') || 58.0;
  items.push({
    id: 'cable_1_5mm_100m',
    nameFr: 'Câble Cuivre 1.5 mm² Éclairage (Rouleau 100m)',
    nameAr: 'سلك نحاسي 1.5 ملم² للإنارة (100 متر)',
    qty: rouleaux1_5,
    unit: 'rouleaux 100m',
    unitPriceTnd: cable1_5Price,
    totalTnd: rouleaux1_5 * cable1_5Price,
    category: 'Câblage',
    packageInfo: `${rouleaux1_5} rouleau(x) de 100m (${input.lightPointsCount} points d'éclairage)`,
    formulaUsed: `(${input.lightPointsCount} points × 18m) / 100`
  });

  const rouleaux2_5 = Math.max(1, Math.ceil((input.powerOutletsCount * 22) / 100));
  const cable2_5Price = getPrice('cable_2_5mm_100m') || 92.0;
  items.push({
    id: 'cable_2_5mm_100m',
    nameFr: 'Câble Cuivre 2.5 mm² Prises (Rouleau 100m)',
    nameAr: 'سلك نحاسي 2.5 ملم² للمقابس (100 متر)',
    qty: rouleaux2_5,
    unit: 'rouleaux 100m',
    unitPriceTnd: cable2_5Price,
    totalTnd: rouleaux2_5 * cable2_5Price,
    category: 'Câblage',
    packageInfo: `${rouleaux2_5} rouleau(x) de 100m (${input.powerOutletsCount} prises)`,
    formulaUsed: `(${input.powerOutletsCount} prises × 22m) / 100`
  });

  if (input.forceLinesCount > 0) {
    const cableForcePrice = 145.0;
    const rouleauxForce = Math.max(1, Math.ceil((input.forceLinesCount * 25) / 100));
    items.push({
      id: 'cable_6mm_100m',
      nameFr: 'Câble Cuivre 6 mm² Lignes de Force (100m)',
      nameAr: 'سلك نحاسي 6 ملم² للخطوط الكبرى (100م)',
      qty: rouleauxForce,
      unit: 'rouleaux 100m',
      unitPriceTnd: cableForcePrice,
      totalTnd: rouleauxForce * cableForcePrice,
      category: 'Câblage',
      packageInfo: `${rouleauxForce} rouleau(x) de 100m (${input.forceLinesCount} lignes force)`,
      formulaUsed: `Lignes chauffe-eau, four, clim`
    });
  }

  const gainesQty = Math.max(1, Math.ceil((totalPoints * 12) / 50));
  const gainePrice = getPrice('gaine_icta_20_50m') || 42.0;
  items.push({
    id: 'gaine_icta_20_50m',
    nameFr: 'Gaine ICTA 20mm Encastrable (Couronne 50m)',
    nameAr: 'أنبوب حماية أسلاك ICTA 20 ملم (50 متر)',
    qty: gainesQty,
    unit: 'couronnes 50m',
    unitPriceTnd: gainePrice,
    totalTnd: gainesQty * gainePrice,
    category: 'Gaines',
    packageInfo: `${gainesQty} couronne(s) de 50m (${gainesQty * 50}m)`,
    formulaUsed: `(${totalPoints} points × 12m) / 50`
  });

  const prisePrice = getPrice('prise_complete_16a') || 7.5;
  items.push({
    id: 'prise_complete_16a',
    nameFr: 'Prises de courant 16A avec Terre Complètes',
    nameAr: 'مقابس كهربائية 16A كاملة مع تأريض',
    qty: input.powerOutletsCount,
    unit: 'pièces',
    unitPriceTnd: prisePrice,
    totalTnd: input.powerOutletsCount * prisePrice,
    category: 'Appareillage',
    packageInfo: `${input.powerOutletsCount} mécanismes + plaques`,
    formulaUsed: `Postes complets 16A`
  });

  if (input.lightPointsCount > 0) {
    const spotPrice = getPrice('spot_led_encastrable') || 8.5;
    items.push({
      id: 'spot_led_encastrable',
      nameFr: 'Spots LED Encastrables 7W / 9W (Complets)',
      nameAr: 'سبوت ليد 7 واط مدمج في الجبس',
      qty: input.lightPointsCount,
      unit: 'pièces',
      unitPriceTnd: spotPrice,
      totalTnd: input.lightPointsCount * spotPrice,
      category: 'Éclairage',
      packageInfo: `${input.lightPointsCount} spots LED complets`,
      formulaUsed: `Spots faux plafond et caissons`
    });
  }

  // Tableau électrique & disjoncteurs
  const disjoncteursCount = Math.ceil(totalPoints / 6) + input.forceLinesCount;
  items.push({
    id: 'tableau_et_disjoncteurs',
    nameFr: `Tableau Électrique + ${disjoncteursCount} Disjoncteurs + Différentiel 30mA`,
    nameAr: 'طابلوه كهربائي مع قواطع وفارق تفاضلي 30mA',
    qty: 1,
    unit: 'forfait',
    unitPriceTnd: 120.0 + (disjoncteursCount * 11.0),
    totalTnd: 120.0 + (disjoncteursCount * 11.0),
    category: 'Protection',
    packageInfo: `Tableau équipé selon normes NFC 15-100`,
    formulaUsed: `1 coffret + ${disjoncteursCount} disj. + 1 diff 30mA`
  });

  const executionSteps = [
    'Tracé des cheminements et encastrements (saignées murales et faux-plafond).',
    'Passage des gaines ICTA et fixation par clips ou plâtre.',
    'Tirage des conducteurs électriques (Phase Rouge/Marron, Neutre Bleu, Terre Vert/Jaune).',
    'Scellement des boîtes d\'encastrement à fleur de mur.',
    'Raccordement au tableau électrique divisionnaire avec repérage des circuits.',
    'Test de continuité de la terre et contrôle de déclenchement du disjoncteur différentiel 30mA.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(totalPoints * input.laborRatePerPoint);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'electricite',
    subType: 'installation_complete',
    subTypeTitle: `Installation Électrique (${totalPoints} Points)`,
    areaM2: input.areaM2,
    netAreaM2: input.areaM2,
    perimeterM: Math.round(Math.sqrt(input.areaM2) * 4),
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Respecter la norme NFC 15-100 (8 points max par disjoncteur 16A).',
      'Fil de terre Vert/Jaune impératif sur chaque point et prise.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 8A - ÉTANCHÉITÉ
export function calculateEtancheite(input: EtancheiteInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];

  if (input.system === 'membrane_bitumineuse') {
    const totalArea = (input.areaM2 + (input.acroterePerimeterM * 0.20)) * 1.15;
    const rouleaux = Math.max(1, Math.ceil(totalArea / 10));
    const membranePrice = getPrice('membrane_etancheite_4mm_10m2') || 95.0;
    items.push({
      id: 'membrane_etancheite_4mm_10m2',
      nameFr: 'Membrane Bitumineuse SBS 4mm Ardoisée (Rouleau 10m²)',
      nameAr: 'غشاء عازل مطاطي بيتومين 4 ملم (10m²)',
      qty: rouleaux,
      unit: 'rouleaux 10m²',
      unitPriceTnd: membranePrice,
      totalTnd: rouleaux * membranePrice,
      category: 'Étanchéité',
      packageInfo: `${rouleaux} rouleau(x) de 10m² (${totalArea.toFixed(1)}m² avec recouvrements et relevés)`,
      formulaUsed: `(${input.areaM2}m² + acrotères) × 1.15 / 10`
    });

    const bitumeBidons = Math.max(1, Math.ceil((input.areaM2 * 0.35) / 20));
    const bitumePrice = getPrice('bitume_liquide_bidon_20l') || 78.0;
    items.push({
      id: 'bitume_liquide_bidon_20l',
      nameFr: 'Primaire Bitumineux Liquide Flintkote (Bidon 20L)',
      nameAr: 'قطران أولي سائل للدهان (20 لتر)',
      qty: bitumeBidons,
      unit: 'bidons 20L',
      unitPriceTnd: bitumePrice,
      totalTnd: bitumeBidons * bitumePrice,
      category: 'Primaire',
      packageInfo: `${bitumeBidons} bidon(s) de 20L (${(input.areaM2 * 0.35).toFixed(1)}L)`,
      formulaUsed: `${input.areaM2}m² × 0.35 L/m²`
    });

    const solinPrice = 14.0;
    const solinsQty = Math.max(1, Math.ceil(input.acroterePerimeterM / 3.0));
    items.push({
      id: 'solin_alu',
      nameFr: 'Profilé Solin Aluminium Porte-Mastic (Barres 3m)',
      nameAr: 'بروفيل ألومنيوم لحماية أعلى العزل',
      qty: solinsQty,
      unit: 'barres 3m',
      unitPriceTnd: solinPrice,
      totalTnd: solinsQty * solinPrice,
      category: 'Finition',
      packageInfo: `${solinsQty} barres de 3m pour acrotères`,
      formulaUsed: `${input.acroterePerimeterM}ml / 3.0`
    });
  } else {
    const resineSeaux = Math.max(1, Math.ceil((input.areaM2 * 1.6) / 20));
    const resinePrice = getPrice('resine_etancheite_liquide_20kg') || 125.0;
    items.push({
      id: 'resine_etancheite_liquide_20kg',
      nameFr: 'Résine Liquide Sous Carrelage SEL (Seau 20kg)',
      nameAr: 'عازل سائل تحت التبليط (سطال 20كغ)',
      qty: resineSeaux,
      unit: 'seaux 20kg',
      unitPriceTnd: resinePrice,
      totalTnd: resineSeaux * resinePrice,
      category: 'Résine',
      packageInfo: `${resineSeaux} seau(x) de 20kg (2 couches croisées)`,
      formulaUsed: `${input.areaM2}m² × 1.6 kg/m²`
    });
  }

  const executionSteps = [
    'Nettoyage soigné et séchage parfait de la dalle de toiture terrasse.',
    'Réalisation des gorges d\'angle (solins arrondis) à la jonction dalle/acrotères.',
    'Application de la couche primaire d\'imprégnation bitumineuse à froid.',
    'Soudage au chalumeau propane de la membrane bitumineuse avec recouvrement minimal de 10cm.',
    'Exécution soignée des relevés d\'étanchéité verticaux de 15 à 20cm sur les acrotères.',
    'Fixation mécanique du profilé solin aluminium et calfeutrement au mastic polyuréthane.',
    'Test d\'étanchéité par mise en eau pendant 48 heures avant protection ou circulation.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.areaM2 * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'etancheite',
    subType: input.system,
    subTypeTitle: input.system === 'membrane_bitumineuse' ? 'Étanchéité Toiture Terrasse (Membrane 4mm)' : 'Étanchéité Liquide Sous Carrelage (SEL)',
    areaM2: input.areaM2,
    netAreaM2: input.areaM2,
    perimeterM: input.acroterePerimeterM,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Relevés d’étanchéité verticaux obligatoires de 15 à 20cm sur les acrotères.',
      'Effectuer un test de mise en eau pendant 48h avant tout recouvrement.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 8B - ISOLATION
export function calculateIsolation(input: IsolationInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  if (input.insulationType === 'laine_de_verre_50mm') {
    const rolls = Math.max(1, Math.ceil((input.areaM2 * wasteFactor) / 15.0));
    const price = getPrice('laine_de_verre_50mm') || 75.0;
    items.push({
      id: 'laine_de_verre_50mm',
      nameFr: 'Laine de Verre 50mm avec Kraft (Rouleau 15m²)',
      nameAr: 'صوف زجاجي 50 ملم (رول 15m²)',
      qty: rolls,
      unit: 'rouleaux 15m²',
      unitPriceTnd: price,
      totalTnd: rolls * price,
      category: 'Isolant',
      packageInfo: `${rolls} rouleau(x) de 15m²`,
      formulaUsed: `(${input.areaM2}m² × ${wasteFactor.toFixed(2)}) / 15.0`
    });
  } else if (input.insulationType === 'laine_de_roche_50mm') {
    const boxes = Math.max(1, Math.ceil((input.areaM2 * wasteFactor) / 7.2));
    const price = getPrice('laine_de_roche_50mm') || 90.0;
    items.push({
      id: 'laine_de_roche_50mm',
      nameFr: 'Laine de Roche Haute Densité 50mm (Boîte 7.2m²)',
      nameAr: 'صوف صخري عالي الكثافة 50 ملم (7.2m²)',
      qty: boxes,
      unit: 'boîtes 7.2m²',
      unitPriceTnd: price,
      totalTnd: boxes * price,
      category: 'Isolant',
      packageInfo: `${boxes} boîte(s) de 7.2m²`,
      formulaUsed: `(${input.areaM2}m² × ${wasteFactor.toFixed(2)}) / 7.2`
    });
  } else {
    // polystyrene → Polystyrène Extrudé XPS (panneaux rigides 1.20m × 0.60m = 0.72 m²)
    const panels = Math.max(1, Math.ceil((input.areaM2 * wasteFactor) / 0.72));
    const price = getPrice('polystyrene_xps_50mm') || 15.0;
    items.push({
      id: 'polystyrene_xps_50mm',
      nameFr: 'Polystyrène Extrudé XPS 50mm (Panneau 1.20m × 0.60m)',
      nameAr: 'بولسترين ممدد XPS 50 ملم (لوح 1.20 × 0.60)',
      qty: panels,
      unit: 'panneaux 0.72m²',
      unitPriceTnd: price,
      totalTnd: panels * price,
      category: 'Isolant',
      packageInfo: `${panels} panneau(x) de 0.72m²`,
      formulaUsed: `(${input.areaM2}m² × ${wasteFactor.toFixed(2)}) / 0.72`
    });
  }

  const bandesRolls = Math.max(1, Math.ceil((Math.sqrt(input.areaM2) * 4) / 30));
  const bandePrice = getPrice('bande_resiliente_48mm') || 25.0;
  items.push({
    id: 'bande_resiliente_48mm',
    nameFr: 'Bande Résiliente Acoustique 48mm (Rouleau 30m)',
    nameAr: 'شريط عازل للصدمات الصوتية 30 متر',
    qty: bandesRolls,
    unit: 'rouleaux 30m',
    unitPriceTnd: bandePrice,
    totalTnd: bandesRolls * bandePrice,
    category: 'Accessoires',
    packageInfo: `${bandesRolls} rouleau(x) de 30m`,
    formulaUsed: `Désolidarisation acoustique périphérique`
  });

  const executionSteps = [
    'Pose de la bande résiliente sur toutes les parties en contact avec la structure maçonnée.',
    'Mise en place de l\'isolant minéral à l\'intérieur de la structure sans compression.',
    'Orientation du pare-vapeur kraft vers le côté chauffé de la pièce.',
    'Scotcher soigneusement les joints de pare-vapeur pour assurer l\'étanchéité à l\'air.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.areaM2 * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'isolation',
    subType: input.insulationType,
    subTypeTitle: `Isolation Thermique & Phonique (${input.areaM2}m²)`,
    areaM2: input.areaM2,
    netAreaM2: input.areaM2,
    perimeterM: Math.round(Math.sqrt(input.areaM2) * 4),
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Ne pas comprimer excessivement la laine minérale pour conserver sa performance thermique.',
      'Utiliser impérativement des protections (masque et gants) pendant la pose.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 9 - MENUISERIE
export function calculateMenuiserie(input: MenuiserieInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];

  const doorPrice = input.subType === 'bloc_porte_decor' 
    ? (getPrice('bloc_porte_stratifee_83') || 280.0)
    : input.subType === 'porte_fenetre_alu'
    ? (getPrice('porte_fenetre_alu_2v') || 450.0)
    : (getPrice('bloc_porte_isoplane_83') || 185.0);

  const doorNameFr = input.subType === 'bloc_porte_decor' 
    ? 'Bloc-Porte Stratifié Décor Bois Complet'
    : input.subType === 'porte_fenetre_alu'
    ? 'Porte-Fenêtre Aluminium Double Vitrage'
    : 'Bloc-Porte Isoplane Bois 83x204cm';

  const doorNameAr = input.subType === 'bloc_porte_decor'
    ? 'باب داخلي مفصلات ديكور خشب'
    : input.subType === 'porte_fenetre_alu'
    ? 'نافذة شرفة ألمنيوم بلور مزدوج'
    : 'باب داخلي إيزوبلان 83×204 سم';

  items.push({
    id: input.subType,
    nameFr: `${doorNameFr} (${input.unitsCount} unités)`,
    nameAr: doorNameAr,
    qty: input.unitsCount,
    unit: 'unités',
    unitPriceTnd: doorPrice,
    totalTnd: input.unitsCount * doorPrice,
    category: 'Menuiserie',
    packageInfo: `${input.unitsCount} bloc(s) complet(s) avec dormant et paumelles`,
    formulaUsed: `${input.unitsCount} unité(s) commandée(s)`
  });

  const moussePrice = getPrice('mousse_pu_750ml') || 18.0;
  const mousseQty = Math.max(1, Math.ceil(input.unitsCount / 2));
  items.push({
    id: 'mousse_pu_750ml',
    nameFr: 'Mousse Polyuréthane Expansive (Aérosol 750ml)',
    nameAr: 'رغوة بولي يوريثان عازلة للمنيرية (750 مل)',
    qty: mousseQty,
    unit: 'aérosols',
    unitPriceTnd: moussePrice,
    totalTnd: mousseQty * moussePrice,
    category: 'Fixations',
    packageInfo: `${mousseQty} aérosol(s) de 750ml (1 pour 2 portes)`,
    formulaUsed: `${input.unitsCount} portes / 2`
  });

  const visAncragePrice = getPrice('vis_ancrage_maconnerie_boite') || 28.0;
  items.push({
    id: 'vis_ancrage_maconnerie_boite',
    nameFr: 'Vis d’Ancrage Cadre Maçonnerie (Boîte 100)',
    nameAr: 'براغي تثبيت إطارات في الخرسانة (علبة 100)',
    qty: 1,
    unit: 'boîte 100',
    unitPriceTnd: visAncragePrice,
    totalTnd: visAncragePrice,
    category: 'Fixations',
    packageInfo: `1 boîte de 100 vis (6-8 vis par cadre)`,
    formulaUsed: `Fixation mécanique directe`
  });

  const masticPrice = getPrice('mastic_silicone_neutre_310ml') || 12.5;
  const masticQty = Math.max(1, Math.ceil(input.unitsCount / 2));
  items.push({
    id: 'mastic_silicone_neutre_310ml',
    nameFr: 'Mastic Silicone Neutre / Acrylique (Cartouche 310ml)',
    nameAr: 'سيليكون عازل لمفاصل النوافذ والأبواب 310 مل',
    qty: masticQty,
    unit: 'cartouches',
    unitPriceTnd: masticPrice,
    totalTnd: masticQty * masticPrice,
    category: 'Finition',
    packageInfo: `${masticQty} cartouche(s) de 310ml`,
    formulaUsed: `Calfeutrement périphérique air/eau`
  });

  const executionSteps = [
    'Vérification des dimensions de la baie maçonnée et de l\'aplomb des parois.',
    'Positionnement du dormant avec cales d\'épaisseur et maintien avec des serre-joints.',
    'Contrôle rigoureux des diagonales (équerrage) et du niveau à bulle.',
    'Fixation mécanique par vis d\'ancrage spécifiques sans cheville (3 à 4 points par montant).',
    'Injection modérée de mousse polyuréthane pour calfeutrement thermique et acoustique.',
    'Arasement de la mousse après durcissement complet (2-3h).',
    'Pose des chambranles / couvre-joints et réalisation du joint silicone de finition.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.unitsCount * input.laborRatePerUnit);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'menuiserie',
    subType: input.subType,
    subTypeTitle: `Pose Menuiserie (${input.unitsCount} Unités)`,
    areaM2: input.unitsCount * 2.0,
    netAreaM2: input.unitsCount * 2.0,
    perimeterM: input.unitsCount * 6.0,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Contrôler l\'équerrage en vérifiant que les 2 diagonales sont rigoureusement identiques.',
      'Ne pas surcharger en mousse expansive pour éviter la déformation des montants du dormant.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 10 - SOLS & PARQUETS
export function calculateSols(input: SolsInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];
  const wasteFactor = 1 + (input.wasteMarginPercent / 100);

  const m2Parquet = Math.ceil(input.areaM2 * wasteFactor);
  const parquetPrice = getPrice('parquet_stratifie_8mm_m2') || 34.0;
  items.push({
    id: 'parquet_stratifie_8mm_m2',
    nameFr: 'Parquet Stratifié HDF 8mm AC4 Haute Résistance (m²)',
    nameAr: 'باركيه خشب رقائقي 8 ملم AC4 (m²)',
    qty: m2Parquet,
    unit: 'm²',
    unitPriceTnd: parquetPrice,
    totalTnd: m2Parquet * parquetPrice,
    category: 'Revêtement',
    packageInfo: `${m2Parquet} m² de parquet stratifié (${(m2Parquet - input.areaM2).toFixed(1)}m² de chutes)`,
    formulaUsed: `${input.areaM2}m² × ${wasteFactor.toFixed(2)}`
  });

  const sousCouchePrice = getPrice('sous_couche_acoustique_sol_m2') || 3.5;
  items.push({
    id: 'sous_couche_acoustique_sol_m2',
    nameFr: 'Sous-Couche Mousse Acoustique & Pare-Vapeur (m²)',
    nameAr: 'طبقة عازلة تحت الباركيه (m²)',
    qty: m2Parquet,
    unit: 'm²',
    unitPriceTnd: sousCouchePrice,
    totalTnd: m2Parquet * sousCouchePrice,
    category: 'Sous-couche',
    packageInfo: `${m2Parquet} m² de sous-couche avec film étanche`,
    formulaUsed: `${m2Parquet} m²`
  });

  const perimeter = Math.round(Math.sqrt(input.areaM2) * 4);
  const plinthesQty = Math.ceil((perimeter * 1.10) / 2.4);
  items.push({
    id: 'plinthes_mdf_decor_2_4m',
    nameFr: 'Plinthes MDF Décor Bois 2.40m',
    nameAr: 'حواف أرضية MDF ديكور خشب (2.40 متر)',
    qty: plinthesQty,
    unit: 'barres 2.4m',
    unitPriceTnd: 11.0,
    totalTnd: plinthesQty * 11.0,
    category: 'Finition',
    packageInfo: `${plinthesQty} barres de 2.40m (${(plinthesQty * 2.4).toFixed(1)} ml)`,
    formulaUsed: `(${perimeter}m périmètre × 1.10) / 2.4`
  });

  const seuilsQty = Math.max(1, Math.ceil(Math.sqrt(input.areaM2) / 4));
  items.push({
    id: 'barre_seuil_porte_alu',
    nameFr: 'Barre de Seuil de Porte Alu Anodisé (90cm)',
    nameAr: 'فاصل عتبة باب ألومنيوم (90 سم)',
    qty: seuilsQty,
    unit: 'pièces',
    unitPriceTnd: 15.0,
    totalTnd: seuilsQty * 15.0,
    category: 'Finition',
    packageInfo: `${seuilsQty} barre(s) de seuil`,
    formulaUsed: `Transitions de portes`
  });

  const executionSteps = [
    'Nettoyage et dépoussiérage méticuleux du sol support.',
    'Vérification de la planéité (flèche max 3mm sous la règle de 2m).',
    'Déroulement de la sous-couche acoustique avec relevé de 2cm le long des murs.',
    'Stockage des paquets de parquet 48h dans la pièce avant pose.',
    'Pose flottante clipsable en partant du coin gauche, languette vers le mur.',
    'Mise en place obligatoire des cales de dilatation (8 à 10mm) en périphérie.',
    'Emboîtement des rangées successives avec décalage minimal de 30cm des aboutages.',
    'Retrait des cales et pose des plinthes fixées au mur (jamais au parquet).'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.areaM2 * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'sols',
    subType: input.solType,
    subTypeTitle: `Pose Parquet Stratifié (${input.areaM2}m²)`,
    areaM2: input.areaM2,
    netAreaM2: input.areaM2,
    perimeterM: perimeter,
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Laisser 8 à 10mm de jeu de dilatation périphérique le long des murs.',
      'Laisser acclimater le parquet 48h dans la pièce avant le déballage.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 11 - FAÇADE
export function calculateFacade(input: FacadeInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const netArea = Math.max(0, input.areaM2 - input.openingsArea);
  const items: MaterialItemResult[] = [];

  const enduitSacs = Math.max(1, Math.ceil((netArea * 19) / 25));
  const enduitPrice = getPrice('enduit_monocouche_facade_25kg') || 26.0;
  items.push({
    id: 'enduit_monocouche_facade_25kg',
    nameFr: 'Enduit Monocouche Hydrofuge Façade (Sac 25kg)',
    nameAr: 'لياسة واجهة خارجية عازلة (كيس 25كغ)',
    qty: enduitSacs,
    unit: 'sacs 25kg',
    unitPriceTnd: enduitPrice,
    totalTnd: enduitSacs * enduitPrice,
    category: 'Enduit',
    packageInfo: `${enduitSacs} sac(s) de 25kg (${(netArea * 19).toFixed(1)} kg pour 12mm)`,
    formulaUsed: `${netArea.toFixed(1)}m² × 19 kg/m²`
  });

  const corniereQty = Math.max(1, Math.ceil((Math.sqrt(input.areaM2) * 4) / 2.5));
  items.push({
    id: 'corniere_facade_entoilee_pvc',
    nameFr: 'Baguette d’Angle Entoilée PVC pour Façade (2.5m)',
    nameAr: 'زاوية واجهة PVC مع شبكة 2.5 متر',
    qty: corniereQty,
    unit: 'pièces 2.5m',
    unitPriceTnd: 5.5,
    totalTnd: corniereQty * 5.5,
    category: 'Accessoires',
    packageInfo: `${corniereQty} baguette(s) de 2.5m`,
    formulaUsed: `Protection arêtes extérieures`
  });

  const executionSteps = [
    'Nettoyage haute pression et humidification abondante des murs de façade.',
    'Pose des baguettes d\'angle entoilées PVC sur toutes les arêtes.',
    'Application de la première passe d\'enduit monocouche (épaisseur 6-8mm).',
    'Application de la seconde passe fraîche sur fraîche (épaisseur totale 12-15mm).',
    'Dressage à la règle et finition au choix (grattée, talochée ou écrasée).',
    'Protection des surfaces fraîches contre le soleil direct et le vent fort.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(netArea * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'facade',
    subType: input.type,
    subTypeTitle: `Enduit de Façade Extérieure (${netArea.toFixed(1)}m²)`,
    areaM2: input.areaM2,
    netAreaM2: netArea,
    perimeterM: Math.round(Math.sqrt(input.areaM2) * 4),
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Ne pas appliquer sous pluie ou température supérieure à 35°C.',
      'Respecter une épaisseur minimale de 10-12mm pour garantir l’imperméabilité.'
    ],
    executionSteps,
    ...fiscal
  };
}

// PART 12 - DÉMOLITION
export function calculateDemolition(input: DemolitionInput, rates: MaterialRate[]): CalculationResult {
  const getPrice = (id: string) => rates.find(r => r.id === id)?.unitPriceTnd || 0;
  const items: MaterialItemResult[] = [];

  const rawVolumeM3 = input.areaM2 * (input.thicknessCm / 100);
  const foisonneVolumeM3 = rawVolumeM3 * 1.40;

  const camionsQty = Math.max(1, Math.ceil(foisonneVolumeM3 / 6.0));
  const camionPrice = getPrice('camion_evacuation_gravats_6m3') || 160.0;
  items.push({
    id: 'camion_evacuation_gravats_6m3',
    nameFr: `Forfait Camions Évacuation Gravats (${foisonneVolumeM3.toFixed(1)} m³ foisonnés)`,
    nameAr: `شاحنات نقل وتفريغ الرديم والأوساخ (${foisonneVolumeM3.toFixed(1)} m³)`,
    qty: camionsQty,
    unit: 'camions 6m³',
    unitPriceTnd: camionPrice,
    totalTnd: camionsQty * camionPrice,
    category: 'Évacuation',
    packageInfo: `${camionsQty} rotation(s) camion 6m³ (${foisonneVolumeM3.toFixed(1)} m³ calculés)`,
    formulaUsed: `${input.areaM2}m² × ${(input.thicknessCm / 100).toFixed(2)}m × 1.40 foisonnement / 6.0`
  });

  const sacsQty = Math.max(1, Math.ceil(foisonneVolumeM3 * 20));
  const sacsPrice = 15.0; // lot de 10
  const sacsLots = Math.ceil(sacsQty / 10);
  items.push({
    id: 'sacs_gravats_renforces_10pcs',
    nameFr: 'Sacs à Gravats Tissés Renforcés (Lot de 10)',
    nameAr: 'أكياس أنقاض مقواة للشوانط (حزمة 10)',
    qty: sacsLots,
    unit: 'lots de 10',
    unitPriceTnd: sacsPrice,
    totalTnd: sacsLots * sacsPrice,
    category: 'Manutention',
    packageInfo: `${sacsLots * 10} sacs renforcés pour évacuation propre`,
    formulaUsed: `${sacsQty} sacs nécessaires`
  });

  const executionSteps = [
    'Consignation préalable et coupure de l\'eau, du gaz et de l\'électricité de la zone.',
    'Balisage et mise en place des protections de sécurité (bâches, masques FFP3, casques).',
    'Arrosage périodique d\'eau pour abattre les poussières fines en suspension.',
    'Démolition méthodique de haut en bas sans créer de surcharges sur les planchers.',
    'Mise en sacs et évacuation par goulottes ou monte-charge vers la benne.',
    'Transport et déchargement réglementaire en décharge publique agréée.'
  ];

  const totalMaterialTnd = items.reduce((acc, curr) => acc + curr.totalTnd, 0);
  const estimatedLaborTnd = Math.round(input.areaM2 * input.laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: 'demolition',
    subType: input.type,
    subTypeTitle: `Démolition & Évacuation Gravats (${foisonneVolumeM3.toFixed(1)}m³)`,
    areaM2: input.areaM2,
    netAreaM2: input.areaM2,
    perimeterM: Math.round(Math.sqrt(input.areaM2) * 4),
    materialItems: items,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent: input.wasteMarginPercent,
    fieldNotes: [
      'Vérifier impérativement l’absence de câbles électriques ou canalisations sous tension.',
      'Arroser les gravats d’eau pour abattre la poussière pendant l’abattage.'
    ],
    executionSteps,
    ...fiscal
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 13 — GENERIC / DATA-DRIVEN CALCULATION (Phase D)
// ══════════════════════════════════════════════════════════════════════════════
// Any trade — including dynamically imported ones with no dedicated strategy —
// enters the pipeline here. Materials are resolved by trade/category and priced
// from the supplied rates. Quantities are derived from generic, unit-aware
// coverage rules keyed on the material's unit type, so no hardcoded trade branch
// and no fake number is ever introduced: every line is traceable to a real
// material + a documented generic formula.
export interface GenericInput extends FiscalOptions {
  trade: string;
  /**
   * READ-PATH IDENTITY (métier → materials) — OPTIONAL registry identity of the
   * selected métier, supplied by the caller (CalculatorTab reads it from the
   * trade registry `/api/v1/trades`). Additive: every existing call site (and
   * test) that omits both fields keeps the HISTORICAL trade/category matching,
   * byte-identical.
   *
   *  - `tradeId`     — the trade RECORD uuid; a material row carrying the same
   *                    `tradeId` (published by App.tsx from `/prices`) belongs
   *                    to this métier even when its `trade`/`category` hold a
   *                    supplier family label.
   *  - `tradeAliases`— additional identity spellings of the SAME métier (its
   *                    registry `labelFr`/`labelAr`), matched with the same
   *                    `catalogKey` normalization as `trade`/`category`.
   *
   * No new formula, no new quantity rule, no genericQty change.
   */
  tradeId?: string;
  tradeAliases?: string[];
  areaM2: number;
  lengthM?: number;
  heightM?: number;
  wasteMarginPercent: number;
  laborRatePerM2: number;
}

/** Generic quantity keyed on material unit. Documented, not invented per-trade.
 *
 * SAFE FIX (Dynamic Trade → Outils):
 * Units the price pipeline cannot resolve are normalized to `unit` by
 * `normalizeRateUnit()` (priceLookup), and the old `unit + panneau` shared
 * branch applied the BTP panel rule `ceil(Area / 3) × waste` to equipment as
 * well. That rule is ONLY valid for `panneau` (board coverage). `unit`
 * (equipment / non-surface piece) and any truly unknown unit use a neutral
 * quantity of 1 — no area scaling, no invented price, no trade-code coupling.
 *
 * UNIT FIDELITY FIX (CSV `m / m² / Unit / Kg / Litre / Set`):
 * The real imported units are now preserved instead of collapsing to `unit`,
 * so they are priced by their own documented rule: `m` = linear metre (same
 * rule as `ml`), `kg` = mass, `m²` = area, `unit`/`set` = one piece, `litre` =
 * neutral (a litre's coverage depends on the product's m²/L yield — no rule is
 * invented). Nothing changes for the 12 official calculators: their rates use
 * `m² / ml / kg / sac / boite / rouleau / boite_1000 / tube / point / panneau /
 * unit` and every one of those branches is byte-identical.
 */
function genericQty(unit: string, area: number, length: number, wasteFactor: number): { qty: number; formula: string } {
  switch (unit) {
    case 'm²':
      return { qty: Math.round(area * wasteFactor * 100) / 100, formula: `Area(${area}) × waste(${wasteFactor})` };
    case 'ml':
    case 'm':
      // Linear metre. 'ml' is the historical union member; 'm' is the raw CSV/DB
      // unit (`materials.base_unit` = 'm') preserved by `normalizeRateUnit()`.
      // Both spellings describe the same per-linear-metre price, so they share
      // the ONE documented rule — no new formula is invented.
      return { qty: Math.round(length * wasteFactor * 100) / 100, formula: `Length(${length}) × waste(${wasteFactor})` };
    case 'kg':
      return { qty: Math.round(area * 0.5 * wasteFactor * 100) / 100, formula: `Area(${area}) × 0.5kg/m² × waste` };
    case 'sac':
      return { qty: Math.max(1, Math.ceil(area / 10 * wasteFactor)), formula: `ceil(Area(${area}) / 10) × waste` };
    case 'boite':
      return { qty: Math.max(1, Math.ceil(area / 15 * wasteFactor)), formula: `ceil(Area(${area}) / 15) × waste` };
    case 'rouleau':
      return { qty: Math.max(1, Math.ceil(area / 12 * wasteFactor)), formula: `ceil(Area(${area}) / 12) × waste` };
    case 'panneau':
      return { qty: Math.max(1, Math.ceil(area / 3 * wasteFactor)), formula: `ceil(Area(${area}) / 3) × waste` };
    case 'unit':
      // Equipment / non-surface piece: neutral quantity, never the BTP /3 panel rule.
      return { qty: 1, formula: `1 unit (neutral equipment quantity — no area scaling)` };
    case 'set':
      // Assembly / kit / set (CSV unit 'set'): sold as ONE piece. The neutral
      // quantity is unchanged — only the REAL unit is now shown instead of the
      // collapsed 'unit' label.
      return { qty: 1, formula: `1 set (neutral set/kit quantity — no area scaling)` };
    case 'litre':
      // Pre-packaged liquid (peinture, résine, additif): a litre's coverage
      // depends on the product's m²/L yield, so NO generic coverage rule is
      // invented here — neutral 1 litre, with the REAL unit preserved (before
      // the unit-fidelity fix this line was shown as "1 unit").
      return { qty: 1, formula: `1 litre (neutral quantity — no generic coverage rule)` };
    case 'point':
      return { qty: Math.max(1, Math.ceil(area / 4)), formula: `ceil(Area(${area}) / 4) points` };
    case 'boite_1000':
    case 'tube':
    case 'm³':
    case 'mètre':
      // Allowed union members with no dedicated generic rule: preserve the exact
      // legacy fallback behaviour (area × waste) so existing trades are untouched.
      return { qty: Math.round(area * wasteFactor * 100) / 100, formula: `Area(${area}) × waste (generic)` };
    default:
      // Truly unknown unit string (not resolvable by normalizeRateUnit): neutral,
      // never area-scaled.
      return { qty: 1, formula: `1 unit (unknown unit — neutral quantity, no area scaling)` };
  }
}

/** P2 — canonical comparison key for a trade/category/trade-code value.
 * Dynamic-trade fix: same normalization as the Outils display (`catalogKey` —
 * trim + strip accents + lowercase + collapse separators/spaces) so spelling
 * variants ('Aluminium'/'aluminium', 'Profilés'/'profiles',
 * 'Installation Chauffroie'/'installation_chauffroie') resolve to the same
 * materials. Read-path only: no DB/CSV write, no formula change. */
function normalizeTradeKey(value: string | null | undefined): string {
  return catalogKey(value);
}

export function calculateGeneric(input: GenericInput, rates: MaterialRate[]): CalculationResult {
  const { trade, areaM2, lengthM = 0, wasteMarginPercent, laborRatePerM2 } = input;
  const area = Math.max(0, areaM2);
  const length = Math.max(0, lengthM);
  const wasteFactor = 1 + (wasteMarginPercent / 100);

  // Resolve the materials of this trade by the display `category` OR by the
  // authoritative trade code carried by the price row, both normalized with
  // the same key as the Outils display (accents/separators/case-insensitive).
  // P2 — this is what links an ACTUAL imported material (server row: trade
  // "hvac") to its trade calculator even when its category is a supplier
  // family label or an empty string, instead of falling back to the
  // "Matériau <trade> 0.000" placeholder line.
  //
  // READ-PATH IDENTITY (métier → materials) — the métier may also be identified
  // by its REGISTRY RECORD: the trade uuid (`tradeId`, published onto the rate
  // by the App.tsx sync) or the registry label (`tradeAliases` — e.g. the
  // "Aluminium" record whose materials are filed under a supplier family
  // label). Matching is ADDITIVE: when the caller supplies neither field, the
  // identity-key set is exactly {tradeKey} and the two historical clauses below
  // keep their byte-identical behaviour. genericQty and every equation are
  // untouched.
  const tradeKey = normalizeTradeKey(trade);
  const identityKeys = new Set<string>();
  if (tradeKey !== '') identityKeys.add(tradeKey);
  for (const alias of input.tradeAliases ?? []) {
    const aliasKey = normalizeTradeKey(alias);
    if (aliasKey !== '') identityKeys.add(aliasKey);
  }
  const inputTradeId = (input.tradeId || '').trim();
  const tradeRates = rates.filter(r => {
    // 0) The trade RECORD identity itself (uuid ↔ uuid), when both sides
    //    carry it. Raw equality — ids are never normalized or rewritten.
    const rateTradeId = (r.tradeId || '').trim();
    if (inputTradeId !== '' && rateTradeId !== '' && rateTradeId === inputTradeId) return true;
    const byCategory = normalizeTradeKey(r.category);
    const byTrade = normalizeTradeKey(r.trade);
    // 1) Historical matching, unchanged (trade/category ↔ trade key).
    if ((byCategory !== '' && byCategory === tradeKey)
      || (byTrade !== '' && byTrade === tradeKey)) return true;
    // 2) Registry identity — the record's label / alias spellings resolve the
    //    SAME métier's materials (registry label ↔ rate trade/category key).
    return (byCategory !== '' && identityKeys.has(byCategory))
      || (byTrade !== '' && identityKeys.has(byTrade));
  });

  const materialItems: MaterialItemResult[] = tradeRates.map(rate => {
    const { qty, formula } = genericQty(rate.unit, area, length, wasteFactor);
    const unitPrice = rate.unitPriceTnd ?? rate.defaultPriceTnd ?? 0;
    const totalTnd = Math.round(qty * unitPrice * 100) / 100;
    return {
      id: rate.id,
      nameFr: rate.nameFr,
      nameAr: rate.nameAr,
      qty,
      unit: rate.unit,
      unitPriceTnd: unitPrice,
      totalTnd,
      category: trade,
      formulaUsed: formula,
    };
  });

  // When no trade-specific materials exist in the rates table, produce one
  // placeholder line so the UI always shows a traceable, honest line rather than
  // an empty or fabricated result.
  if (materialItems.length === 0) {
    materialItems.push({
      id: `${trade}-material`,
      nameFr: `Matériau ${trade}`,
      nameAr: `مادة ${trade}`,
      qty: Math.round(area * wasteFactor * 100) / 100,
      unit: 'm²',
      unitPriceTnd: 0,
      totalTnd: 0,
      category: trade,
      formulaUsed: `Area(${area}) × waste(${wasteFactor})`,
    });
  }

  const totalMaterialTnd = materialItems.reduce((acc, it) => acc + it.totalTnd, 0);
  const estimatedLaborTnd = Math.round(area * laborRatePerM2);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, input);

  return {
    trade: trade as TradeCategory,
    subType: trade,
    subTypeTitle: trade,
    areaM2: area,
    netAreaM2: area,
    perimeterM: area > 0 ? Math.round(Math.sqrt(area) * 4) : 0,
    materialItems,
    totalMaterialTnd,
    estimatedLaborTnd,
    grandTotalTnd: fiscal.grandTotalTnd,
    wasteMarginPercent,
    fieldNotes: [
      tradeRates.length > 0
        ? `Calcul générique pour le métier '${trade}' — ${tradeRates.length} matériau(x) résolu(s) depuis le barème.`
        : `Calcul générique pour le métier '${trade}' — aucun matériau dans le barème ; ajoutez des matériaux au catalogue pour obtenir les prix.`,
    ],
    ...fiscal,
  };
}

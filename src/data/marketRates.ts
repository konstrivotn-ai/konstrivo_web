import { MaterialRate } from '../types';

export const DEFAULT_MARKET_RATES: MaterialRate[] = [
  // PLACO & GYPSE
  {
    id: 'plaque_ba13_standard',
    category: 'placo',
    nameFr: 'Plaque BA13 Standard (1.2m x 2.5m = 3m²)',
    nameAr: 'لوح جبس BA13 عادي',
    unit: 'unit',
    unitPriceTnd: 30.0,
    defaultPriceTnd: 30.0,
    note: 'Standard 12.5mm pour cloisons et plafonds intérieurs'
  },
  {
    id: 'plaque_ba13_hydrofuge',
    category: 'placo',
    nameFr: 'Plaque BA13 Hydrofuge Vert (1.2m x 2.5m = 3m²)',
    nameAr: 'لوح جبس BA13 مقاوم للرطوبة (خضراء)',
    unit: 'unit',
    unitPriceTnd: 46.0,
    defaultPriceTnd: 46.0,
    note: 'Salles de bain, cuisines et pièces humides'
  },
  {
    id: 'plaque_ba13_coupe_feu',
    category: 'placo',
    nameFr: 'Plaque BA13 Coupe-Feu Rose (1.2m x 2.5m = 3m²)',
    nameAr: 'لوح جبس BA13 مقاوم للحريق (وردية)',
    unit: 'unit',
    unitPriceTnd: 50.0,
    defaultPriceTnd: 50.0,
    note: 'Résistance élevée au feu et hautes températures'
  },
  {
    id: 'plaque_ba13_phonique',
    category: 'placo',
    nameFr: 'Plaque BA13 Phonique Bleu (1.2m x 2.5m = 3m²)',
    nameAr: 'لوح جبس BA13 عازل للصوت (زرقاء)',
    unit: 'unit',
    unitPriceTnd: 55.0,
    defaultPriceTnd: 55.0,
    note: 'Isolation acoustique renforcée (+50% d’atténuation)'
  },
  {
    id: 'plaque_habito_durete',
    category: 'placo',
    nameFr: 'Plaque Haute Dureté / Habito (1.2m x 2.5m = 3m²)',
    nameAr: 'لوح جبس عالي الصلابة والصدمات Habito',
    unit: 'unit',
    unitPriceTnd: 68.0,
    defaultPriceTnd: 68.0,
    note: 'Supporte charges lourdes (jusqu\'à 20kg par vis sans cheville)'
  },
  {
    id: 'plaque_aquapanel_ciment',
    category: 'placo',
    nameFr: 'Plaque Cement Board Aquapanel Outdoor (1.2m x 2.4m = 2.88m²)',
    nameAr: 'لوح إسمنتي ألواباك Aquapanel خارجي للواجهات',
    unit: 'unit',
    unitPriceTnd: 85.0,
    defaultPriceTnd: 85.0,
    note: 'Portland cement + armature fibre pour façades et zones exposées à l\'eau'
  },
  {
    id: 'plaque_aquapanel_exterieur',
    category: 'placo',
    nameFr: 'Cement Board / Aquapanel Outdoor (1.2m x 2.4m = 2.88m²)',
    nameAr: 'لوح إسمنتي بورتلاند للواجهات الخارجية Aquapanel',
    unit: 'unit',
    unitPriceTnd: 85.0,
    defaultPriceTnd: 85.0,
    note: 'Portland cement + armature fibre pour façades et zones exposées à l\'eau'
  },
  {
    id: 'plaque_aquapanel_interieur',
    category: 'placo',
    nameFr: 'Cement Board Indoor / Tile Backer (1.2m x 2.4m = 2.88m²)',
    nameAr: 'لوح إسمنتي داخلي لدعم السيراميك والحمامات',
    unit: 'unit',
    unitPriceTnd: 72.0,
    defaultPriceTnd: 72.0,
    note: 'Support étanche haute adhérence pour carrelage mural'
  },
  {
    id: 'plaque_silicate_calcium',
    category: 'placo',
    nameFr: 'Plaque Silicate de Calcium Protex / FireStop (1.2m x 2.5m)',
    nameAr: 'لوح سيليكات الكالسيوم مضاد فائق للحريق Protex',
    unit: 'unit',
    unitPriceTnd: 95.0,
    defaultPriceTnd: 95.0,
    note: 'Résistance extrême au feu (EI 120 / EI 240) et gaines techniques'
  },
  {
    id: 'panneau_pvc_plafond',
    category: 'placo',
    nameFr: 'Panneau PVC Décoratif Plafond (0.25m x 3.0m = 0.75m²)',
    nameAr: 'شريحة PVC ديكورية للسقف والأماكن الرطبة',
    unit: 'unit',
    unitPriceTnd: 12.0,
    defaultPriceTnd: 12.0,
    note: 'Résistance 100% à l\'eau sans peinture, finition brillante/mate'
  },
  {
    id: 'plaque_glassroc_exterieur',
    category: 'placo',
    nameFr: 'Plaque Glassroc X Extérieur (1.2m x 2.4m)',
    nameAr: 'لوح Glassroc للواجهات والأسقف الخارجية',
    unit: 'unit',
    unitPriceTnd: 75.0,
    defaultPriceTnd: 75.0,
    note: 'Plaque spéciale extérieure sous enduit'
  },

  // DALLES PLAFOND DÉMONTABLE
  {
    id: 'dalle_vinyl_60x60',
    category: 'placo',
    nameFr: 'Dalle Vinyle 60x60 cm pour Plafond Démontable',
    nameAr: 'بلاطة سقف تفكيكي فينيل 60×60 سم',
    unit: 'unit',
    unitPriceTnd: 5.5,
    defaultPriceTnd: 5.5,
    note: 'Lavable, idéal pour bureaux et locaux médicaux'
  },
  {
    id: 'dalle_laine_roche_60x60',
    category: 'placo',
    nameFr: 'Dalle Laine de Roche 60x60 cm Acoustique',
    nameAr: 'بلاطة صوف صخري 60×60 سم عازلة',
    unit: 'unit',
    unitPriceTnd: 10.0,
    defaultPriceTnd: 10.0,
    note: 'Haute absorption acoustique et thermique'
  },

  // ARMATURES ET PROFILÉS MÉTALLIQUES
  {
    id: 'rail_48',
    category: 'placo',
    nameFr: 'Rail 48 mm (Longueur 3 mètres)',
    nameAr: 'قضيب سفلي Rail 48 (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 7.5,
    defaultPriceTnd: 7.5,
    note: 'Sert de guide horizontal sol et plafond (largeur 48mm)'
  },
  {
    id: 'montant_48',
    category: 'placo',
    nameFr: 'Montant 48 mm (Longueur 3 mètres)',
    nameAr: 'عمود رأسي Montant 48 (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 8.0,
    defaultPriceTnd: 8.0,
    note: 'Structure verticale espacée de 40cm ou 60cm'
  },
  {
    id: 'rail_70',
    category: 'placo',
    nameFr: 'Rail 70 mm Renforcé (Longueur 3 mètres)',
    nameAr: 'قضيب سفلي Rail 70 مدعم (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 10.5,
    defaultPriceTnd: 10.5,
    note: 'Guide horizontal pour cloisons acoustiques et de grande hauteur'
  },
  {
    id: 'montant_70',
    category: 'placo',
    nameFr: 'Montant 70 mm Renforcé (Longueur 3 mètres)',
    nameAr: 'عمود رأسي Montant 70 مدعم (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 11.5,
    defaultPriceTnd: 11.5,
    note: 'Montant vertical pour hauteurs jusqu\'à 3.60m sans renfort'
  },
  {
    id: 'rail_90',
    category: 'placo',
    nameFr: 'Rail 90 mm Heavy Duty (Longueur 3 mètres)',
    nameAr: 'قضيب سفلي Rail 90 عريض (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 14.0,
    defaultPriceTnd: 14.0,
    note: 'Guide horizontal 90mm pour isolation phonique maximale'
  },
  {
    id: 'montant_90',
    category: 'placo',
    nameFr: 'Montant 90 mm Heavy Duty (Longueur 3 mètres)',
    nameAr: 'عمود رأسي Montant 90 عريض (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 15.5,
    defaultPriceTnd: 15.5,
    note: 'Montant vertical pour hauteurs supérieures à 4.20m'
  },
  {
    id: 'fourrure',
    category: 'placo',
    nameFr: 'Fourrure F47 (Longueur 3 mètres)',
    nameAr: 'مجاري سقوف Fourrure (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 7.0,
    defaultPriceTnd: 7.0,
    note: 'Profilé métallique pour plafond fixe BA13'
  },
  {
    id: 'corniere_angle',
    category: 'placo',
    nameFr: 'Cornière L de Rive (Longueur 3 mètres)',
    nameAr: 'زاوية حافة L (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 6.5,
    defaultPriceTnd: 6.5,
    note: 'Finition périphérique plafond et z-angles'
  },
  {
    id: 'omega_profil',
    category: 'placo',
    nameFr: 'Profilé Oméga (Longueur 3 mètres)',
    nameAr: 'بروفيل أوميغا تقوية (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 8.5,
    defaultPriceTnd: 8.5,
    note: 'Renfort métallique pour sur-charges'
  },

  // GRILLE PLAFOND DÉMONTABLE
  {
    id: 'porteur_3600',
    category: 'placo',
    nameFr: 'Porteur T24 / T15 (3.60 mètres)',
    nameAr: 'حامل رئيسي T24 (3.6 متر)',
    unit: 'unit',
    unitPriceTnd: 14.0,
    defaultPriceTnd: 14.0,
    note: 'Profile principal du système démontable'
  },
  {
    id: 'entretoise_1200',
    category: 'placo',
    nameFr: 'Entretoise T24 (1.20 mètres)',
    nameAr: 'عريضة وسطية (1.2 متر)',
    unit: 'unit',
    unitPriceTnd: 4.5,
    defaultPriceTnd: 4.5,
    note: 'Profilé secondaire intermédiaire'
  },
  {
    id: 'entretoise_600',
    category: 'placo',
    nameFr: 'Entretoise T24 (0.60 mètres)',
    nameAr: 'عريضة قصيرة (0.6 متر)',
    unit: 'unit',
    unitPriceTnd: 2.5,
    defaultPriceTnd: 2.5,
    note: 'Ferme la maille 60x60cm'
  },
  {
    id: 'corniere_rive_L',
    category: 'placo',
    nameFr: 'Cornière de Rive L 3m (Démontable)',
    nameAr: 'زاوية حافة سقف تفكيكي (3 أمتار)',
    unit: 'unit',
    unitPriceTnd: 8.0,
    defaultPriceTnd: 8.0,
    note: 'Tour de pièce pour plafond démontable'
  },

  // VISSERIE & FIXATIONS
  {
    id: 'vis_placo_25',
    category: 'placo',
    nameFr: 'Vis Placo TTPC 25mm (Boîte de 1000)',
    nameAr: 'براغي جبس 25 ملم (علبة 1000)',
    unit: 'boite_1000',
    unitPriceTnd: 22.0,
    defaultPriceTnd: 22.0,
    note: 'Fixation des plaques BA13 sur ossature'
  },
  {
    id: 'vis_trpf',
    category: 'placo',
    nameFr: 'Vis TRPF Métal-Métal (Boîte de 1000)',
    nameAr: 'براغي هيكل معدني TRPF (علبة 1000)',
    unit: 'boite_1000',
    unitPriceTnd: 26.0,
    defaultPriceTnd: 26.0,
    note: 'Assemblage des profilés métal et rallonges'
  },
  {
    id: 'vis_aquapanel',
    category: 'placo',
    nameFr: 'Vis Inox Aquapanel (Boîte de 500)',
    nameAr: 'براغي إينوكس ألواباك (علبة 500)',
    unit: 'boite',
    unitPriceTnd: 35.0,
    defaultPriceTnd: 35.0,
    note: 'Traitement anti-corrosion spécial ciment'
  },
  {
    id: 'suspente',
    category: 'placo',
    nameFr: 'Suspente Pivot ou Articulée',
    nameAr: 'تعليقة سقف Suspente',
    unit: 'unit',
    unitPriceTnd: 0.8,
    defaultPriceTnd: 0.8,
    note: 'Soutient les fourrures sous la dalle'
  },
  {
    id: 'tige_filetee_1m',
    category: 'placo',
    nameFr: 'Tige Filetée M6 (Longueur 1m)',
    nameAr: 'ساق مسننة 1 متر',
    unit: 'unit',
    unitPriceTnd: 3.0,
    defaultPriceTnd: 3.0,
    note: 'Pour suspensions de plafond haut'
  },
  {
    id: 'cavalier_pivot',
    category: 'placo',
    nameFr: 'Cavalier Pivot Fourrure',
    nameAr: 'مشبك تثبيت Cavalier',
    unit: 'unit',
    unitPriceTnd: 0.6,
    defaultPriceTnd: 0.6,
    note: 'Liaison tige filetée et fourrure'
  },

  // ENDUITS, BANTES & INSULATION
  {
    id: 'enduit_joint_25kg',
    category: 'placo',
    nameFr: 'Enduit de Jointage Placo (Sac de 25kg)',
    nameAr: 'معجون مفاصل الجبس (كيس 25كغ)',
    unit: 'sac',
    unitPriceTnd: 42.0,
    defaultPriceTnd: 42.0,
    note: '3 passes de finition sur joints'
  },
  {
    id: 'colle_gypse_25kg',
    category: 'placo',
    nameFr: 'Colle Gypse pour Doublage Collé (Sac 25kg)',
    nameAr: 'غراء جبس للتثبيت المباشر (كيس 25كغ)',
    unit: 'sac',
    unitPriceTnd: 35.0,
    defaultPriceTnd: 35.0,
    note: 'Consommation ~2.5 kg/m²'
  },
  {
    id: 'bande_a_joint_90m',
    category: 'placo',
    nameFr: 'Bande à Joint Papier (Rouleau de 90m)',
    nameAr: 'شريط مفاصل ورقي (90 متر)',
    unit: 'rouleau',
    unitPriceTnd: 18.0,
    defaultPriceTnd: 18.0,
    note: 'Armature de jointure entre plaques'
  },
  {
    id: 'trame_fibre_exterieur',
    category: 'placo',
    nameFr: 'Trame de Renfort Fibre de Verre (Rouleau 50m)',
    nameAr: 'شبكة ألياف خارجية (50 متر)',
    unit: 'rouleau',
    unitPriceTnd: 45.0,
    defaultPriceTnd: 45.0,
    note: 'Tissu d’armature sous enduit ciment'
  },
  {
    id: 'colle_ciment_exterieur_25kg',
    category: 'placo',
    nameFr: 'Colle Ciment Spéciale Extérieur / Aquapanel (Sac 25kg)',
    nameAr: 'إسمنت لاصق خارجي (كيس 25كغ)',
    unit: 'sac',
    unitPriceTnd: 65.0,
    defaultPriceTnd: 65.0,
    note: 'Haute adhérence résistant aux intempéries'
  },
  {
    id: 'laine_de_verre_50mm',
    category: 'isolation',
    nameFr: 'Laine de Verre 50mm (Rouleau de 15m²)',
    nameAr: 'صوف زجاجي 50ملم (رول 15m²)',
    unit: 'rouleau',
    unitPriceTnd: 75.0,
    defaultPriceTnd: 75.0,
    note: 'Isolation thermique et phonique légère'
  },
  {
    id: 'laine_de_roche_50mm',
    category: 'isolation',
    nameFr: 'Laine de Roche Densité Forte 50mm (Panneau 7.2m²)',
    nameAr: 'صوف صخري 50ملم عالي الكثافة (7.2m²)',
    unit: 'boite',
    unitPriceTnd: 90.0,
    defaultPriceTnd: 90.0,
    note: 'Excellente isolation phonique et protection feu'
  },
  {
    id: 'bande_resiliente_48mm',
    category: 'isolation',
    nameFr: 'Bande Résiliente Acoustique 48mm (Rouleau 30m)',
    nameAr: 'شريط عازل تحت الهيكل المعدني (30 متر)',
    unit: 'rouleau',
    unitPriceTnd: 25.0,
    defaultPriceTnd: 25.0,
    note: 'Évite la transmission des vibrations acoustiques'
  },
  {
    id: 'silicone_coupe_feu',
    category: 'isolation',
    nameFr: 'Cartouche Silicone Coupe-Feu',
    nameAr: 'سيليكون مقاوم للحريق',
    unit: 'tube',
    unitPriceTnd: 22.0,
    defaultPriceTnd: 22.0,
    note: 'Calfeutrement étanche des joints feu'
  },

  // PEINTURE
  {
    id: 'peinture_acrylique_10l',
    category: 'peinture',
    nameFr: 'Peinture Acrylique Mate Intérieur (Seau 10L)',
    nameAr: 'دهان أكرليك مات داخلي (سطال 10L)',
    unit: 'unit',
    unitPriceTnd: 65.0,
    defaultPriceTnd: 65.0,
    note: 'Rendement ~10 m²/L par couche'
  },
  {
    id: 'peinture_satinee_10l',
    category: 'peinture',
    nameFr: 'Peinture Satinée / Gloss Lavable (Seau 10L)',
    nameAr: 'دهان ساتينيه نصف لامع قابل للغسل (سطال 10L)',
    unit: 'unit',
    unitPriceTnd: 95.0,
    defaultPriceTnd: 95.0,
    note: 'Très résistante aux taches et au nettoyage'
  },
  {
    id: 'peinture_elastique_10l',
    category: 'peinture',
    nameFr: 'Peinture Élastique Façade Extérieure (Seau 10L)',
    nameAr: 'دهان مطاطي إيلاستيك للواجهات (سطال 10L)',
    unit: 'unit',
    unitPriceTnd: 140.0,
    defaultPriceTnd: 140.0,
    note: 'Pontage des micro-fissures extérieures'
  },
  {
    id: 'impression_primer_10l',
    category: 'peinture',
    nameFr: 'Impression / Primer Placo Spécial (Seau 10L)',
    nameAr: 'طبقة أساسية بريمر للجبس (سطال 10L)',
    unit: 'unit',
    unitPriceTnd: 55.0,
    defaultPriceTnd: 55.0,
    note: 'Régule la porosité du Placo avant peinture'
  },

  // CARRELAGE & SOLS
  {
    id: 'carreau_standard_30x30',
    category: 'carrelage',
    nameFr: 'Carrelage Sols / Murs 30x30 ou 40x40 (au m²)',
    nameAr: 'تبليط أرضيات/حوائط 30×30 سم (بالـ m²)',
    unit: 'm²',
    unitPriceTnd: 28.0,
    defaultPriceTnd: 28.0,
    note: 'Grès cérame / Céramique standard'
  },
  {
    id: 'carreau_grand_60x60',
    category: 'carrelage',
    nameFr: 'Grès Cérame 60x60 cm Rectifié (au m²)',
    nameAr: 'تبليط خزف كبير 60×60 سم (بالـ m²)',
    unit: 'm²',
    unitPriceTnd: 48.0,
    defaultPriceTnd: 48.0,
    note: 'Finition moderne rectifiée joints fins'
  },

  // MAÇONNERIE
  {
    id: 'brique_rouge_12trous',
    category: 'maconnerie',
    nameFr: 'Brique Rouge 12 Trous (Unité)',
    nameAr: 'آجر أحمر 12 ثقب (قطعة)',
    unit: 'unit',
    unitPriceTnd: 0.95,
    defaultPriceTnd: 0.95,
    note: 'Brique de cloisonnement standard'
  },
  {
    id: 'bloc_beton_20x20x40',
    category: 'maconnerie',
    nameFr: 'Bloc Béton / Parpaing 20x20x40 cm (Unité)',
    nameAr: 'بلوك خرساني باربان 20×20×40 (قطعة)',
    unit: 'unit',
    unitPriceTnd: 1.60,
    defaultPriceTnd: 1.60,
    note: 'Mur porteur et maçonnerie lourde'
  },
  {
    id: 'sac_ciment_50kg',
    category: 'maconnerie',
    nameFr: 'Sac de Ciment 50kg (CEM I / CEM II)',
    nameAr: 'كيس أسمنت 50 كغ',
    unit: 'sac',
    unitPriceTnd: 19.5,
    defaultPriceTnd: 19.5,
    note: 'Prix réglementé en Tunisie'
  },

  // PLOMBERIE (PART 6)
  {
    id: 'ppr_tube_20_4m',
    category: 'plomberie',
    nameFr: 'Tube PPR PN20 Diamètre 20mm (Barre 4m)',
    nameAr: 'أنبوب بولي بروبيلين PPR 20ملم (قضيب 4 أمتار)',
    unit: 'unit',
    unitPriceTnd: 9.5,
    defaultPriceTnd: 9.5,
    note: 'Alimentation eau chaude et froide sanitaire'
  },
  {
    id: 'ppr_tube_25_4m',
    category: 'plomberie',
    nameFr: 'Tube PPR PN20 Diamètre 25mm (Barre 4m)',
    nameAr: 'أنبوب PPR 25ملم للشبكة الرئيسية (4 أمتار)',
    unit: 'unit',
    unitPriceTnd: 14.0,
    defaultPriceTnd: 14.0,
    note: 'Colonne montante et débit principal'
  },
  {
    id: 'pvc_tube_110_4m',
    category: 'plomberie',
    nameFr: 'Tube PVC Évacuation 110mm (Barre 4m)',
    nameAr: 'أنبوب صرف صحي PVC 110ملم (4 أمتار)',
    unit: 'unit',
    unitPriceTnd: 24.0,
    defaultPriceTnd: 24.0,
    note: 'Évacuation des eaux vannes (WC)'
  },
  {
    id: 'pvc_tube_40_4m',
    category: 'plomberie',
    nameFr: 'Tube PVC Évacuation 40mm (Barre 4m)',
    nameAr: 'أنبوب صرف صحي PVC 40ملم (4 أمتار)',
    unit: 'unit',
    unitPriceTnd: 9.0,
    defaultPriceTnd: 9.0,
    note: 'Évacuation lavabo, douche et évier'
  },
  {
    id: 'raccord_ppr_coude_te',
    category: 'plomberie',
    nameFr: 'Raccord PPR Coude / Té / Manchon (Unité)',
    nameAr: 'كوع / موصل PPR للتلحيم',
    unit: 'unit',
    unitPriceTnd: 1.8,
    defaultPriceTnd: 1.8,
    note: 'Soudure par thermo-fusion à 260°C'
  },
  {
    id: 'colle_pvc_pot',
    category: 'plomberie',
    nameFr: 'Colle PVC Pression avec pinceau (Pot 250g)',
    nameAr: 'غراء أنابيب PVC (علبة 250 غرام)',
    unit: 'unit',
    unitPriceTnd: 11.0,
    defaultPriceTnd: 11.0,
    note: 'Collage étanche des raccords d’évacuation'
  },

  // ÉLECTRICITÉ (PART 7)
  {
    id: 'cable_1_5mm_100m',
    category: 'electricite',
    nameFr: 'Câble Électrique Cuivre 1.5 mm² (Rouleau 100m)',
    nameAr: 'سلك نحاسي معزول 1.5 ملم² (لفة 100 متر)',
    unit: 'rouleau',
    unitPriceTnd: 58.0,
    defaultPriceTnd: 58.0,
    note: 'Circuit d’éclairage et commande'
  },
  {
    id: 'cable_2_5mm_100m',
    category: 'electricite',
    nameFr: 'Câble Électrique Cuivre 2.5 mm² (Rouleau 100m)',
    nameAr: 'سلك نحاسي معزول 2.5 ملم² (لفة 100 متر)',
    unit: 'rouleau',
    unitPriceTnd: 92.0,
    defaultPriceTnd: 92.0,
    note: 'Circuit des prises de courant standard'
  },
  {
    id: 'cable_4mm_100m',
    category: 'electricite',
    nameFr: 'Câble Électrique Cuivre 4.0 / 6.0 mm² (Rouleau 100m)',
    nameAr: 'سلك كهربائي قوي 4-6 ملم² (لفة 100 متر)',
    unit: 'rouleau',
    unitPriceTnd: 148.0,
    defaultPriceTnd: 148.0,
    note: 'Pour climatiseurs, cuisinières et chauffe-eau'
  },
  {
    id: 'gaine_icta_16_50m',
    category: 'electricite',
    nameFr: 'Gaine Annulée ICTA 16mm (Couronne 50m)',
    nameAr: 'أنبوب حماية الأسلاك ICTA 16ملم (50 متر)',
    unit: 'rouleau',
    unitPriceTnd: 32.0,
    defaultPriceTnd: 32.0,
    note: 'Passage encastré des fils d’éclairage'
  },
  {
    id: 'gaine_icta_20_50m',
    category: 'electricite',
    nameFr: 'Gaine Annulée ICTA 20mm (Couronne 50m)',
    nameAr: 'أنبوب حماية الأسلاك ICTA 20ملم (50 متر)',
    unit: 'rouleau',
    unitPriceTnd: 42.0,
    defaultPriceTnd: 42.0,
    note: 'Passage des câbles de prises et puissance'
  },
  {
    id: 'prise_complete_16a',
    category: 'electricite',
    nameFr: 'Prise de Courant 16A avec Terre Complète',
    nameAr: 'مقبس كهربائي 16 أمبير مع أرضي',
    unit: 'unit',
    unitPriceTnd: 7.5,
    defaultPriceTnd: 7.5,
    note: 'Mécanisme encastrable complet'
  },
  {
    id: 'spot_led_encastrable',
    category: 'electricite',
    nameFr: 'Spot LED Encastrable 7W / 9W (Complet)',
    nameAr: 'سبوت ليد 7 واط مدمج في الجبس',
    unit: 'unit',
    unitPriceTnd: 8.5,
    defaultPriceTnd: 8.5,
    note: 'Finition plafond placo et caissons'
  },

  // ÉTANCHÉITÉ (PART 8A)
  {
    id: 'bitume_liquide_bidon_20l',
    category: 'etancheite',
    nameFr: 'Bitume Liquide d’Imprégnation à Froid (Bidon 20L)',
    nameAr: 'قطران بيتوميني سائل للعزل المائي (20 لتر)',
    unit: 'unit',
    unitPriceTnd: 78.0,
    defaultPriceTnd: 78.0,
    note: 'Couche primaire pour terrasses et fondations'
  },
  {
    id: 'membrane_etancheite_4mm_10m2',
    category: 'etancheite',
    nameFr: 'Membrane Bitumineuse SBS 4mm Ardoisée (Rouleau 10m²)',
    nameAr: 'غشاء عازل مطاطي بيتومين 4 ملم (10m²)',
    unit: 'rouleau',
    unitPriceTnd: 95.0,
    defaultPriceTnd: 95.0,
    note: 'Étanchéité soudée au chalumeau pour toiture terrasse'
  },
  {
    id: 'resine_etancheite_liquide_20kg',
    category: 'etancheite',
    nameFr: 'Résine Liquide d’Étanchéité Sous Carrelage (Seau 20kg)',
    nameAr: 'عازل سائل تحت التبليط للحمامات (20كغ)',
    unit: 'unit',
    unitPriceTnd: 125.0,
    defaultPriceTnd: 125.0,
    note: 'Protection imperméable pour douches à l’italienne'
  },

  // MENUISERIE (PART 9)
  {
    id: 'mousse_pu_750ml',
    category: 'menuiserie',
    nameFr: 'Mousse Polyuréthane Expansive (Aérosol 750ml)',
    nameAr: 'رغوة بولي يوريثان عازلة للمنيرية (750 مل)',
    unit: 'unit',
    unitPriceTnd: 18.0,
    defaultPriceTnd: 18.0,
    note: 'Calfeutrement et fixation des dormants de portes et fenêtres'
  },
  {
    id: 'bloc_porte_isoplane_83',
    category: 'menuiserie',
    nameFr: 'Bloc-Porte Intérieur Isoplane Bois 83x204cm',
    nameAr: 'باب داخلي إيزوبلان خشب 83×204 سم',
    unit: 'unit',
    unitPriceTnd: 185.0,
    defaultPriceTnd: 185.0,
    note: 'Avec bâti, chambranle et paumelles'
  },
  {
    id: 'mastic_silicone_neutre_310ml',
    category: 'menuiserie',
    nameFr: 'Mastic Silicone Neutre / Acrylique (Cartouche 310ml)',
    nameAr: 'سيليكون عازل لمفاصل النوافذ والأبواب 310 مل',
    unit: 'tube',
    unitPriceTnd: 12.5,
    defaultPriceTnd: 12.5,
    note: 'Étanchéité périphérique air/eau'
  },
  {
    id: 'vis_ancrage_maconnerie_boite',
    category: 'menuiserie',
    nameFr: 'Vis d’Ancrage Cadre Maçonnerie (Boîte de 100)',
    nameAr: 'براغي تثبيت إطارات في الخرسانة (علبة 100)',
    unit: 'boite',
    unitPriceTnd: 28.0,
    defaultPriceTnd: 28.0,
    note: 'Fixation directe sans cheville des dormants'
  },

  // SOLS & PARQUET (PART 10)
  {
    id: 'parquet_stratifie_8mm_m2',
    category: 'sols',
    nameFr: 'Parquet Stratifié HDF 8mm AC4 Haute Résistance (au m²)',
    nameAr: 'باركيه رقائقي 8 ملم HDF مقاوم (بالـ m²)',
    unit: 'm²',
    unitPriceTnd: 34.0,
    defaultPriceTnd: 34.0,
    note: 'Pose flottante clipsable avec sous-couche'
  },
  {
    id: 'sous_couche_acoustique_sol_m2',
    category: 'sols',
    nameFr: 'Sous-Couche Mousse Acoustique & Pare-Vapeur (au m²)',
    nameAr: 'طبقة عازلة للصوت والرطوبة تحت الباركيه',
    unit: 'm²',
    unitPriceTnd: 3.5,
    defaultPriceTnd: 3.5,
    note: 'Isolation phonique aux bruits d’impact'
  },
  {
    id: 'plinthes_mdf_decor_2_4m',
    category: 'sols',
    nameFr: 'Plinthe MDF Décor Bois 2.40m',
    nameAr: 'حواف أرضية MDF ديكور خشب (2.40 متر)',
    unit: 'unit',
    unitPriceTnd: 11.0,
    defaultPriceTnd: 11.0,
    note: 'Finition périphérique des sols stratifiés'
  },
  {
    id: 'barre_seuil_porte_alu',
    category: 'sols',
    nameFr: 'Barre de Seuil de Porte Alu Anodisé (90cm)',
    nameAr: 'فاصل عتبة باب ألومنيوم (90 سم)',
    unit: 'unit',
    unitPriceTnd: 15.0,
    defaultPriceTnd: 15.0,
    note: 'Transition et dilatation entre pièces'
  },

  // FAÇADE & EXTÉRIEUR (PART 11)
  {
    id: 'enduit_monocouche_facade_25kg',
    category: 'facade',
    nameFr: 'Enduit Monocouche Hydrofuge pour Façade (Sac 25kg)',
    nameAr: 'لياسة إسمنتية ملونة مقاومة للرطوبة (25كغ)',
    unit: 'sac',
    unitPriceTnd: 26.0,
    defaultPriceTnd: 26.0,
    note: 'Imperméabilisation et décoration des murs extérieurs'
  },
  {
    id: 'corniere_facade_entoilee_pvc',
    category: 'facade',
    nameFr: 'Baguette d’Angle Entoilée PVC pour Façade (2.5m)',
    nameAr: 'زاوية واجهة PVC مع شبكة 2.5 متر',
    unit: 'unit',
    unitPriceTnd: 5.5,
    defaultPriceTnd: 5.5,
    note: 'Protection des arêtes extérieures'
  },

  // DÉMOLITION (PART 12)
  {
    id: 'camion_evacuation_gravats_6m3',
    category: 'demolition',
    nameFr: 'Forfait Camionnette / Camion Évacuation Gravats (6m³)',
    nameAr: 'نقل وتفريغ الأنقاض والحطام (شاحنة 6m³)',
    unit: 'unit',
    unitPriceTnd: 160.0,
    defaultPriceTnd: 160.0,
    note: 'Transport agréé vers décharge publique'
  },
  {
    id: 'sacs_gravats_renforces_10pcs',
    category: 'demolition',
    nameFr: 'Sacs à Gravats Tissés Ultra-Résistants (Lot de 10)',
    nameAr: 'أكياس أنقاض مقواة للشوانط (حزمة 10)',
    unit: 'boite',
    unitPriceTnd: 15.0,
    defaultPriceTnd: 15.0,
    note: 'Manutention propre en étages et appartements'
  }
];

export const REGIONS_TUNISIA = [
  'Tunis Grand',
  'Ariana / Manouba',
  'Nabeul / Cap Bon',
  'Bizerte',
  'Sousse / Monastir / Mahdia',
  'Sfax',
  'Kairouan / Sidi Bouzid',
  'Gabès / Medenine / Djerba',
  'Autre / الشانطي'
];

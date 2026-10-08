import { KnowledgeArticle } from '../types';

export const KNOWLEDGE_ARTICLES: KnowledgeArticle[] = [
  {
    id: 'kb-placo',
    partNumber: 2,
    code: 'PART 2',
    titleFr: 'PLACO / PLÂTRE & CLOISONS',
    titleAr: 'الجبس، الأسقف والجدران المستعارة (PLACO)',
    category: 'placo',
    introduction: 'La technologie Placo (plaques de plâtre armé BA13/BA15) est le standard moderne pour la division d’espaces, plafonds suspendus et isolation thermique/acoustique en Tunisie. Elle offre rapidité de pose, esthétique plane et faible surcharge structurelle.',
    subTypes: [
      {
        name: '1.1 Cloison Fixe Simple (BA13 / BA15)',
        description: 'Séparation simple sans isolation. Armature métallique montée de montants et rails, habillée de plaques d’un seul côté ou des deux côtés.',
        specs: 'Rendement rapide. Idéal pour séparation de bureau ou rangements.'
      },
      {
        name: '1.2 Cloison Double Peau (Double Briques Plâtre)',
        description: 'Deux couches de plaques de plâtre BA13 de chaque côté pour une meilleure stabilité mécanique et isolation acoustique.',
        specs: 'Utilisé dans les logements résidentiels haut de gamme.'
      },
      {
        name: '1.3 Cloison avec Isolation Laine de Verre/Roche',
        description: 'Insertion d’un isolant en laine minérale de 50mm entre les montants avant fermeture.',
        specs: 'Impératif pour salles de réunion, chambres et cloisons mitoyennes.'
      },
      {
        name: '1.4 Plafond Suspendu Fixe (Faux Plafond BA13)',
        description: 'Suspendu à la dalle supérieure par tiges filetées et suspentes pivois, guidé par fourrures F47 et cornières L.',
        specs: 'Permet le passage des réseaux électriques, spots et conduits de climatisation.'
      },
      {
        name: '1.5 Plafond Démontable 60x60',
        description: 'Grille métallique apparente (Porteurs 3.6m + Entretoises 1.2m/0.6m) recevant des dalles vinyle ou laine de roche.',
        specs: 'Démontage individuel instantané pour maintenance des câbles et tuyauteries.'
      }
    ],
    executionSteps: [
      '1. Marquage et Traçage (التعليم والقياس): Alignement au cordeau bleu au sol, plafond et murs latéraux avec vérification d’équerre (90°).',
      '2. Pose des Rails Horizontaux (تركيب القضبان): Fixation des rails UW48 au sol et au plafond par cheville à frapper (chaque 60-80cm).',
      '3. Installation des Montants Verticaux (تركيب الأكسسوارات والأعمدة): Pigeage des Montants M48 tous les 60cm (ou 40cm pour charges lourdes/faïence).',
      '4. Passage des Réseaux & Laine Minérale (التمديدات والعزل): Inserer les gaines électriques et poser la laine de roche/verre.',
      '5. Vissage des Plaques (تركيب ألواح الجبس): Pose des plaques BA13 avec vis TTPC 25mm tous les 25cm. Laisser 3-5mm de jeu au sol.',
      '6. Jointoyage et Finition (معالجة المفاصل): Pose de la bande à joint papier collée à l’enduit de jointage, suivi de 2 passes de lissage puis ponçage fin.'
    ],
    dimensionsTable: [
      { element: 'Plaque BA13 Standard', standard: '3.00m x 1.20m = 3.60 m² (ou 2.50m x 1.20m = 3m²)', notes: 'Sépare les pièces sèches' },
      { element: 'Plaque BA13 Hydrofuge', standard: '12.5 mm d’épaisseur (Couleur Verte)', notes: 'Obliagtoire pour SDB et Cuisines' },
      { element: 'Écartement Montants M48', standard: '60 cm (Standard) / 40 cm (Renforcé)', notes: '40cm recommandé si pose de carrelage' },
      { element: 'Profondeur Ancrage Vis', standard: '10 mm au-delà du profilé métallique', notes: 'Ne pas déchirer le carton de la plaque' }
    ],
    formulas: [
      'Plaques BA13 = (Surface Totale / 3.60 m²) x 1.10 (Factor 10% chute)',
      'Rails UW = (Périmètre Pièce / 3m) x 1.05',
      'Montants M48 = (Longueur Cloison / 0.60m) + 1 + Renforts Ouvertures',
      'Vis Placo 25 = Surface Cloison x 15 à 20 vis/m²',
      'Enduit Joint = Surface Cloison x 1.2 kg/m² (sur 3 passes)'
    ],
    variables: [
      '[STANDARD]: Entraxe montants = 60 cm',
      '[VARIABLE]: Entraxe = 40 cm si carrelage mural lourd',
      '[OPTION]: Laine de verre 50mm pour isolation phonique'
    ],
    tips: [
      'Conseil Chantiers Tunisie: Ne jamais poser la plaque Placo directement collée au sol béton. Laissez un vide sanitaire de 5mm avec une cale pour éviter les remontées capillaires d’humidité.',
      'Si la hauteur sous plafond dépasse 3.00 mètres, utilisez obligatoirement des Rallonges métalliques vissées par 4 vis TRPF.'
    ]
  },
  {
    id: 'kb-peinture',
    partNumber: 3,
    code: 'PART 3',
    titleFr: 'PEINTURE & PRÉPARATION DES SURFACES',
    titleAr: 'الدهان والطلاء وتحضير الأسطح (PEINTURE)',
    category: 'peinture',
    introduction: 'Le système de peinture ne se résume pas à l’application d’une couleur. C’est un complexe multicouche assurant la protection contre l’humidité, la régulation du support et l’esthétique finale.',
    subTypes: [
      {
        name: 'Peinture Acrylique Mate',
        description: 'Sèche vite, sans odeur forte, masque les petites imperfections du support.',
        specs: 'Idéale pour plafonds et chambres à coucher.'
      },
      {
        name: 'Peinture Satinée Lavable',
        description: 'Film lisse et résistant, lessivable à l’eau et au savon.',
        specs: 'Recommandée pour couloirs, SDB et cuisines.'
      },
      {
        name: 'Peinture Élastique Façade',
        description: 'Résine synthétique souple capable de ponter les micro-fissures extérieures subissant les chocs thermiques.',
        specs: 'Essentiel sur façades extérieures en Tunisie.'
      }
    ],
    executionSteps: [
      '1. Nettoyage et Égrenage: Brossage, dépoussiérage et grattage des anciennes peintures écaillées.',
      '2. Impression / Primer (بريمر): Application d’une couche de régulation d’absorption sur Placo neuf ou enduit sec.',
      '3. Rebouchage et Ratissage (Enduit): Application de 2 couches d’enduit de lissage pour obtenir une surface miroir.',
      '4. Ponçage Fin (الصنفرة): Utilisation de papier de verre grain 180-220 puis dépoussiérage méticuleux.',
      '5. Finition (الطلاء النهائي): Application de 2 couches croisées au rouleau anti-goutte avec temps de séchage de 6h.'
    ],
    dimensionsTable: [
      { element: 'Rendement Impression', standard: '10 à 12 m² / Litre', notes: 'Fixe le fond pulvérulent' },
      { element: 'Rendement Peinture Acrylique', standard: '9 à 11 m² / Litre / Couche', notes: 'Compter 2 couches' },
      { element: 'Rendement Enduit Rebouchage', standard: '1.5 à 2.5 kg / m²', notes: 'Variable selon état du mur' }
    ],
    formulas: [
      'Litre Peinture Nécessaire = [ (Surface Murs - Ouvertures) / Rendement m²/L ] x Nbr Couches x 1.10',
      'Facteur Correcteur Surface: x 1.2 si mur crépi/brut, x 1.0 si Placo lisse'
    ],
    variables: [
      '[STANDARD]: 2 couches de finition sur impression',
      '[VARIABLE]: 3 couches en cas de changement radical de couleur (ex: de foncé à blanc)'
    ],
    tips: [
      'En été en Tunisie (températures > 35°C), ne peignez jamais en plein soleil direct sur les façades pour éviter le cloquage accéléré de la peinture.'
    ]
  },
  {
    id: 'kb-carrelage',
    partNumber: 4,
    code: 'PART 4',
    titleFr: 'REVÊTEMENTS & CARRELAGE',
    titleAr: 'التبليط والسيراميك والرخام (CARRELAGE)',
    category: 'carrelage',
    introduction: 'Le carrelage (Grès cérame, faïence, marbre) exige un support rigide, plan et sec. En Tunisie, la méthode au mortier colle (Colle ciment) remplace progressivement la pose traditionnelle au sable/ciment.',
    subTypes: [
      {
        name: 'Petit Format (10x10, 20x20 cm)',
        description: 'Faïence pour murs de salle de bain et crédences de cuisine.',
        specs: 'Flexibilité d’alignement optimale.'
      },
      {
        name: 'Format Standard (30x30, 40x40 cm)',
        description: 'Carrelage de sol universel pour pièces de vie.',
        specs: 'Pose rapide et économique.'
      },
      {
        name: 'Grand Format / Rectifié (60x60, 60x120 cm)',
        description: 'Grès cérame haute densité aux bords droits rectifiés.',
        specs: 'Nécessite un double encollage et des croisillons autonivelants.'
      }
    ],
    executionSteps: [
      '1. Préparation du sol (Ragréage / Chape): Vérification de la planéité (écart max 3mm sous la règle de 2m).',
      '2. Traçage du Plan de Pose (الترسيم): Repérage de l’axe central de la pièce pour équilibrer les coupes aux bords.',
      '3. Encollage (تطبيق الغراء): Étalement du mortier colle avec peigne dentelé (8mm ou 10mm). Double encollage si carreau > 45x45cm.',
      '4. Pose et Croisillons (وضع الرقائق): Ajustement des carreaux au maillet caoutchouc avec croisillons de 2 à 3mm.',
      '5. Jointoiement (ملء المفاصل): Application du mortier à joint souple après 24h de séchage de la colle.'
    ],
    dimensionsTable: [
      { element: 'Consommation Colle Ciment', standard: '3.5 à 5.0 kg / m²', notes: 'Selon taille du peigne et double encollage' },
      { element: 'Consommation Mortier Joint', standard: '0.4 à 0.8 kg / m²', notes: 'Dépend de la largeur des joints' },
      { element: 'Largeur de Joint Recommandée', standard: '2mm (Rectifié) à 4mm (Standard)', notes: 'Jamais de pose à refus sans joint' }
    ],
    formulas: [
      'Nombre de Carreaux = (Surface Pièce / Surface 1 Carreau) x 1.10 (Pose droite) ou x 1.15 (Pose diagonale)',
      'Sacs de Colle 25kg = (Surface m² x 4 kg/m²) / 25 kg'
    ],
    variables: [
      '[STANDARD]: Pose droite parallèle au mur principal',
      '[VARIABLE]: Pose diagonale (+15% de perte en coupes)'
    ],
    tips: [
      'Pour le carrelage extérieur ou sur terrasse exposée, utilisez exclusivement une colle Ciment C2E flexible résistant au gel et au gonflement thermique.'
    ]
  },
  {
    id: 'kb-maconnerie',
    partNumber: 5,
    code: 'PART 5',
    titleFr: 'MAÇONNERIE & GROS ŒUVRE',
    titleAr: 'البناء بالأجر والإسمنت (MAÇONNERIE)',
    category: 'maconnerie',
    introduction: 'Montage des murs porteurs et cloisons en briques rouges cuites (Brique 6, 8, 12 trous) ou parpaings béton avec mortier de ciment et sable.',
    subTypes: [
      {
        name: 'Cloison en Brique Rouge 12 Trous',
        description: 'Standard tunisien pour cloisons extérieures à double paroi et murs intérieurs d’épaisseur 15 à 20cm.',
        specs: 'Excellente isolation hygro-thermique naturelle.'
      },
      {
        name: 'Mur en Bloc Béton (Parpaing 20x20x40)',
        description: 'Blocs lourds moulés en béton de ciment pour murs de soubassement et clôtures.',
        specs: 'Haute résistance mécanique à l’écrasement.'
      }
    ],
    executionSteps: [
      '1. Nettoyage du solier et arrosage abondant de la brique.',
      '2. Préparation du mortier (1 volume de ciment pour 3 volumes de sable de rivière).',
      '3. Pose de la première assise au cordeau de maçon avec niveau à bulle.',
      '4. Montage à joints croisés (harpage) avec 10 à 15mm d’épaisseur de mortier.',
      '5. Coulage des chaînages verticaux et linteaux béton armé au-dessus des portes/fenêtres.'
    ],
    dimensionsTable: [
      { element: 'Brique Rouge 12 Trous', standard: '25 x 12 x 6.5 cm', notes: '~28 à 30 briques par m² de mur' },
      { element: 'Parpaing Béton 20x20x40', standard: '40 x 20 x 20 cm', notes: '12.5 blocs par m² de mur' },
      { element: 'Consommation Ciment', standard: '10 à 12 kg de ciment par m² de brique', notes: 'Assure la cohésion des joints' }
    ],
    formulas: [
      'Briques Rouges = Surface Mur m² x 30 briques/m² x 1.05',
      'Volume Mortier m³ = Surface Mur m² x 0.025 m³/m²',
      'Sacs Ciment 50kg = Volume Mortier m³ x 7 sacs'
    ],
    variables: [
      '[STANDARD]: Brique 12 trous pour cloisons 15cm',
      '[VARIABLE]: Brique 8 trous pour cloisons minces 10cm'
    ],
    tips: [
      'Arrosez généreusement les briques rouges avant la pose, sinon la brique sèche va absorber l’eau du mortier et annuler sa prise cimentaire.'
    ]
  },
  {
    id: 'kb-plomberie',
    partNumber: 6,
    code: 'PART 6',
    titleFr: 'PLOMBERIE & SANITAIRES',
    titleAr: 'السباكة والأنابيب (PLOMBERIE)',
    category: 'plomberie',
    introduction: 'Alimentation en eau potable chaude/froide (PPR, Multicouche) et évacuation des eaux usées/vannes (PVC rigide).',
    subTypes: [
      {
        name: 'Réseau PPR (Polypropylène Random)',
        description: 'Tubes rigides soudés à chaud par polyfusion thermique.',
        specs: 'Aucun risque de fuite aux raccordements. Standard sanitaire #1.'
      },
      {
        name: 'Évacuation PVC Rigide (32mm à 110mm)',
        description: 'Tubes assemblés par collage à froid pour la vidange des lavabos (32-40mm) et WC (110mm).',
        specs: 'Respecter une pente minimale de 1.5 à 2cm par mètre.'
      }
    ],
    executionSteps: [
      '1. Traçage des encastrements dans les murs et saignées.',
      '2. Soudure des tubes PPR au miroir chauffant (260°C, temps de chauffe 5-7 sec).',
      '3. Maintien sous pression d’eau de test (6 bars pendant 12h) avant rebouchage des saignées.',
      '4. Pose des évacuations PVC avec collages dégraissés à l’acétone.'
    ],
    dimensionsTable: [
      { element: 'Tube PPR Diamètre 20mm', standard: 'Alimentation lavabo, douche, WC', notes: 'Raccordement individuel' },
      { element: 'Tube PPR Diamètre 25/32mm', standard: 'Colonne principale d’arrivée d’eau', notes: 'Débit général' },
      { element: 'Évacuation WC PVC', standard: 'Diamètre 110 mm', notes: 'Pente min 2%' }
    ],
    formulas: [
      'Longueur Tube PPR = Somme des parcours + 10% pertes',
      'Coudes & Raccords PPR = ~3 à 4 pièces par mètre linéaire de réseau'
    ],
    variables: [
      '[STANDARD]: Tubes PPR PN20 pour eau chaude/froide',
      '[OPTION]: Isolant manchon mousse pour conduite d’eau chaude'
    ],
    tips: [
      'Ne jamais faire tourner les raccords PPR juste après la soudure à chaud pendant la phase de refroidissement (10 sec).'
    ]
  },
  {
    id: 'kb-electricite',
    partNumber: 7,
    code: 'PART 7',
    titleFr: 'ÉLECTRICITÉ & CÂBLAGE',
    titleAr: 'الكهرباء والتمديدات (ÉLECTRICITÉ)',
    category: 'electricite',
    introduction: 'Réseau encastré sous gaines ICTA pour l’éclairage, les prises de courant et les circuits de puissance selon la norme NFC 15-100.',
    subTypes: [
      {
        name: 'Circuit Éclairage 1.5 mm²',
        description: 'Alimentation des points lumineux et spots, protégé par disjoncteur 10A/16A.',
        specs: 'Max 8 points lumineux par circuit.'
      },
      {
        name: 'Circuit Prises 2.5 mm²',
        description: 'Alimentation des prises de courant standard 16A avec terre.',
        specs: 'Max 8 prises par circuit.'
      },
      {
        name: 'Circuit Puissance 4 à 6 mm²',
        description: 'Lignes dédiées pour climatiseurs lourds, plaques à induction et chauffe-eau.',
        specs: 'Disjoncteur individuel 25A/32A.'
      }
    ],
    executionSteps: [
      '1. Pose des gaines noires ICTA 16/20mm dans les saignées ou au plafond Placo.',
      '2. Encastrement des boîtes d’appareillage au plâtre rapide.',
      '3. Aiguillage et tirage des fils électriques cuivre monobrin.',
      '4. Raccordement au tableau électrique principal avec disjoncteur différentiel 30mA.'
    ],
    dimensionsTable: [
      { element: 'Section Câble 1.5mm²', standard: 'Éclairage / Interrupteurs', notes: 'Gaine ICTA 16mm' },
      { element: 'Section Câble 2.5mm²', standard: 'Prises de courant 16A', notes: 'Gaine ICTA 20mm' },
      { element: 'Section Câble 4-6mm²', standard: 'Climatisation / Four / Chauffe-eau', notes: 'Gaine ICTA 25mm' }
    ],
    formulas: [
      'Longueur Fil Cuivre = (Périmètre Pièce x Nbr Fils dans gaine) x 1.15',
      'Gaines ICTA = Longueur totale des parcours + 10%'
    ],
    variables: [
      '[STANDARD]: 3 fils (Phase + Neutre + Terre)',
      '[VARIABLE]: 1.5mm² pour commande va-et-vient (4 fils)'
    ],
    tips: [
      'Toujours utiliser 3 couleurs distinctes : Rouge/Marron (Phase), Bleu (Neutre) et Vert/Jaune (Terre obligatoire).'
    ]
  },
  {
    id: 'kb-etancheite',
    partNumber: 8,
    code: 'PART 8A',
    titleFr: 'ÉTANCHÉITÉ & IMPERMÉABILISATION',
    titleAr: 'العزل المائي والرطوبة (ÉTANCHÉITÉ)',
    category: 'etancheite',
    introduction: 'L’étanchéité empêche toute infiltration d’eau de pluie ou remontée capillaire dans la structure. Indispensable pour terrasses, toitures, douches à l’italienne et fondations en Tunisie.',
    subTypes: [
      {
        name: 'Étanchéité Bitumineuse / Membrane SBS 4mm',
        description: 'Rouleaux de bitume armé soudés à la flamme du chalumeau après primaire d’imprégnation.',
        specs: 'Protection absolue des toitures terrasses exposées au soleil et aux pluies.'
      },
      {
        name: 'Étanchéité Liquide Sous Carrelage (SEL)',
        description: 'Résine synthétique souple appliquée au rouleau formant une membrane continue sans joint.',
        specs: 'Recommandée pour douches, hammams, salles d’eau et balcons.'
      }
    ],
    executionSteps: [
      '1. Nettoyage parfait et séchage de la dalle béton (forme de pente 1.5% min).',
      '2. Application du primaire bitumineux d’accrochage à froid (0.3 kg/m²).',
      '3. Soudure des lés de membrane avec recouvrement de 10cm entre bandes.',
      '4. Relevés d’étanchéité verticaux sur les acrotères (hauteur 15 à 20cm).',
      '5. Test de mise en eau (remplissage 48h) pour vérifier l’absence de fuite.'
    ],
    dimensionsTable: [
      { element: 'Primaire Bitumineux', standard: '0.3 à 0.5 kg / m²', notes: 'Temps de séchage 24h' },
      { element: 'Membrane SBS 4mm', standard: 'Rouleau 10m x 1m', notes: 'Compter +15% pour recouvrements et relevés' },
      { element: 'Relevé d’Acrotère', standard: 'Hauteur min 15 cm au-dessus du niveau fini', notes: 'Bande d’équerre renforcée' }
    ],
    formulas: [
      'Membrane Nécessaire = Surface Terrasse x 1.15 (Recouvrements 10cm inclus)',
      'Primaire d’Imprégnation = Surface Terrasse x 0.35 kg/m²'
    ],
    variables: [
      '[STANDARD]: Membrane 4mm ardoisée auto-protégée contre les UV',
      '[OPTION]: Double couche croisée pour terrasses accessibles'
    ],
    tips: [
      'Ne soudez jamais de membrane d’étanchéité sur une dalle encore humide (risque de poches de vapeur et décollement sous la chaleur).'
    ]
  },
  {
    id: 'kb-isolation',
    partNumber: 8,
    code: 'PART 8B',
    titleFr: 'ISOLATION THERMIQUE & PHONIQUE',
    titleAr: 'العزل الحراري والصوتي (ISOLATION)',
    category: 'isolation',
    introduction: 'L’isolation optimise le confort intérieur en hiver comme en été chaud tunisien, réduisant considérablement la facture de climatisation et de chauffage.',
    subTypes: [
      {
        name: 'Laine de Verre / Laine de Roche 50mm à 100mm',
        description: 'Matelas minéral souple ou semi-rigide inséré dans les cloisons Placo ou faux-plafonds.',
        specs: 'Excellente absorption acoustique et protection incendie incombustible A1.'
      },
      {
        name: 'Polystyrène Extrudé (XPS)',
        description: 'Panneaux rigides à cellules fermées insensibles à l’humidité.',
        specs: 'Idéal sous dallage, toitures inversées et isolation par l’extérieur (ITE).'
      }
    ],
    executionSteps: [
      '1. Découpe des panneaux aux dimensions de l’ossature (+1cm pour serrage).',
      '2. Mise en place serrée sans laisser de pont thermique ni interstice.',
      '3. Pose du pare-vapeur côté chaud (intérieur) si laine minérale.',
      '4. Fermeture rapide avec les plaques de parement BA13.'
    ],
    dimensionsTable: [
      { element: 'Épaisseur Nord Tunisie', standard: '50 à 80 mm', notes: 'Climat tempéré méditerranéen' },
      { element: 'Épaisseur Standard / Sahel', standard: '80 à 120 mm', notes: 'Isolation été / hiver équilibrée' },
      { element: 'Épaisseur Sud / Désertique', standard: '120 à 200 mm', notes: 'Bouclier thermique forte chaleur' }
    ],
    formulas: [
      'Volume Isolant m³ = Surface Paroi m² x Épaisseur (en mètres)',
      'Rouleaux Laine de Verre 15m² = (Surface / 15) x 1.05'
    ],
    variables: [
      '[STANDARD]: 50mm en cloison intérieure séparative',
      '[VARIABLE]: 100mm en toiture terrasse ou sous comble'
    ],
    tips: [
      'Veillez à porter masque et gants lors de la manipulation de la laine de verre pour éviter les irritations de la peau et des voies respiratoires.'
    ]
  },
  {
    id: 'kb-menuiserie',
    partNumber: 9,
    code: 'PART 9',
    titleFr: 'MENUISERIE (BOIS, PVC, ALU)',
    titleAr: 'النجارة والأبواب والنوافذ (MENUISERIE)',
    category: 'menuiserie',
    introduction: 'Fourniture et calfeutrement des ouvrants intérieurs et extérieurs : Portes d’entrée, portes intérieures, fenêtres coulissantes et battantes en Aluminium, PVC et Bois noble.',
    subTypes: [
      {
        name: 'Menuiserie Aluminium (Série 40 / Profils Élite)',
        description: 'Profilés légers, thermo-laqués anti-corrosion, double vitrage thermique 4/12/4.',
        specs: 'Standard moderne #1 en Tunisie pour grandes baies vitrées.'
      },
      {
        name: 'Menuiserie PVC Haute Isolation',
        description: 'Châssis à chambres multiples assurant la meilleure isolation thermique et acoustique.',
        specs: 'Très recommandée dans les zones côtières humides et ventées.'
      },
      {
        name: 'Portes Intérieures en Bois Noble / Isoplane',
        description: 'Portes battantes pleines ou alvéolaires avec couvre-joints et chambranles soignés.',
        specs: 'Largeur standard 80cm pour chambres, 70cm pour salles d’eau.'
      }
    ],
    executionSteps: [
      '1. Vérification du tableau maçonnerie (aplombs, niveaux et cotes nettes).',
      '2. Mise en place du dormant avec cales de niveau et pinces d’alignement.',
      '3. Vissage dans la maçonnerie par vis d’ancrage direct sans cheville.',
      '4. Injection de mousse polyuréthane expansive pour rupture de pont thermique.',
      '5. Réalisation du cordon d’étanchéité extérieur en mastic silicone neutre.'
    ],
    dimensionsTable: [
      { element: 'Porte Chambre Standard', standard: '80 x 210 cm', notes: 'Passage utile ~73 cm' },
      { element: 'Porte Salle d’Eau / WC', standard: '70 x 210 cm', notes: 'Gain d’espace' },
      { element: 'Fenêtre 2 Vantaux Salon', standard: '120 x 120 cm ou 140 x 120 cm', notes: 'Coulissant ou ouvrant' },
      { element: 'Rendement Mousse PU 750ml', standard: '15 mètres linéaires de calfeutrement', notes: 'Séchage à cœur 2h' }
    ],
    formulas: [
      'Mousse PU = (Périmètre Total des Ouvrants / 15ml) flacons',
      'Mastic Silicone = (Périmètre Extérieur / 10ml) cartouches'
    ],
    variables: [
      '[STANDARD]: Vitrage simple 6mm ou double vitrage 4/12/4',
      '[OPTION]: Volet roulant monobloc aluminium motorisé'
    ],
    tips: [
      'Ne coupez la mousse polyuréthane qu’après séchage complet (3 à 4 heures), puis protégez-la impérativement des UV du soleil par un joint silicone ou un couvre-joint.'
    ]
  },
  {
    id: 'kb-sols',
    partNumber: 10,
    code: 'PART 10',
    titleFr: 'SOLS & PARQUETS',
    titleAr: 'الأرضيات الخشبية والباركيه (SOLS)',
    category: 'sols',
    introduction: 'Pose des revêtements de sol en bois et composites : Parquet massif, stratifié clipsable AC4/AC5, dalles vinyles LVT et finitions béton ciré poli.',
    subTypes: [
      {
        name: 'Parquet Stratifié HDF Flottant',
        description: 'Lames à système de clic sans colle posées sur sous-couche acoustique isolante.',
        specs: 'Rapidité d’installation exceptionnelle, prêt à l’emploi immédiatement.'
      },
      {
        name: 'Béton Ciré / Poli Moderne',
        description: 'Enduit minéral coulé sur chape lissée, poncé fin et vitrifié par vernis polyuréthane.',
        specs: 'Aspect architectural continu sans joint, design contemporain.'
      }
    ],
    executionSteps: [
      '1. Ragréage et dépoussiérage méticuleux du sol (humidité support < 3%).',
      '2. Déroulement de la sous-couche pare-vapeur avec scotchage des jonctions.',
      '3. Pose de la 1ère rangée de lames avec cales de dilatation (8 à 10mm aux murs).',
      '4. Emboîtement des rangées suivantes à joints décalés d’au moins 30cm.',
      '5. Fixation des plinthes périphériques masquant le jeu de dilatation.'
    ],
    dimensionsTable: [
      { element: 'Épaisseur Stratifié', standard: '8 mm à 12 mm (Classe 32 / AC4)', notes: 'Résistant au poinçonnement' },
      { element: 'Sous-couche Acoustique', standard: '2 mm à 3 mm', notes: 'Atténue les bruits de pas (-19dB)' },
      { element: 'Jeu Périphérique Dilatation', standard: '8 à 10 mm le long de tous les murs', notes: 'Obligatoire pour éviter le gondolement' }
    ],
    formulas: [
      'M² Parquet Nécessaire = Surface Pièce x 1.10 (10% de chutes en pose droite)',
      'Longueur Plinthes ml = Périmètre Pièce - Largeur des Portes + 10%'
    ],
    variables: [
      '[STANDARD]: Pose droite dans le sens de la lumière naturelle',
      '[OPTION]: Profils de seuil de transition entre pièces de niveaux différents'
    ],
    tips: [
      'Laissez acclimater les cartons de parquet dans la pièce fermée pendant 48 heures avant de commencer la pose pour stabiliser le taux d’humidité du bois.'
    ]
  },
  {
    id: 'kb-facade',
    partNumber: 11,
    code: 'PART 11',
    titleFr: 'FAÇADE & EXTÉRIEUR',
    titleAr: 'الواجهات والتشطيب الخارجي (FAÇADE)',
    category: 'facade',
    introduction: 'Traitement protecteur et décoratif des murs extérieurs soumis aux intempéries tunisiennes : Enduits monocouches grattés/talochés, peintures silicone autonettoyantes et ITE.',
    subTypes: [
      {
        name: 'Enduit Monocouche Hydrofuge',
        description: 'Mortier prédosé projeté manuellement ou à la machine en 12 à 15mm d’épaisseur.',
        specs: 'Assure l’imperméabilisation et la couleur de finition en une seule opération.'
      },
      {
        name: 'Peinture de Façade Résine Silicone / Élastomère',
        description: 'Revêtement souple microporeux laissant respirer le support tout en repoussant l’eau de pluie.',
        specs: 'Empêche l’apparition de moisissures et de fissures de retrait.'
      }
    ],
    executionSteps: [
      '1. Montage de l’échafaudage sécurisé avec filets de protection.',
      '2. Lavage haute pression du support maçonnerie et traitement des fissures.',
      '3. Application d’un gobetis d’accrochage ou passe d’accroche.',
      '4. Application de l’enduit de corps en 12-15mm dressé à la règle crantée.',
      '5. Finition grattée fine ou talochée selon le choix architectural.'
    ],
    dimensionsTable: [
      { element: 'Consommation Enduit Monocouche', standard: '16 à 22 kg / m² pour 12mm', notes: 'Sac de 25kg couvre ~1.2 à 1.4 m²' },
      { element: 'Épaisseur Minimale de Protection', standard: '10 mm finis sur maçonnerie', notes: 'Garantit l’imperméabilité' }
    ],
    formulas: [
      'Sacs Enduit 25kg = (Surface Murs Façade - Ouvertures) x 0.85 sacs/m²',
      'Baguettes d’Angle PVC entoilées = Périmètre des arêtes et fenêtres ml / 2.5m'
    ],
    variables: [
      '[STANDARD]: Finition grattée moyenne ton pierre',
      '[OPTION]: Traitement anti-salissure hydrofuge de surface'
    ],
    tips: [
      'Arrêtez toujours l’application de l’enduit de façade au niveau d’une arête ou d’un joint de rupture, ne jamais s’arrêter en plein milieu d’un pan de mur pour éviter les raccords visibles.'
    ]
  },
  {
    id: 'kb-demolition',
    partNumber: 12,
    code: 'PART 12',
    titleFr: 'DÉMOLITION & ÉVACUATION',
    titleAr: 'الهدم والإزالة ونقل الأنقاض (DÉMOLITION)',
    category: 'demolition',
    introduction: 'Opérations préalables de dépose d’anciennes cloisons, démolition de maçonnerie non porteuse, piquage de carrelage et évacuation des gravats vers décharge publique.',
    subTypes: [
      {
        name: 'Dépose de Cloisons Placo / Brique Légère',
        description: 'Démontage soigné des parements, ossatures et briques de séparation intérieures.',
        specs: 'Nécessite le repérage préalable des gaines électriques et tuyaux encastrés.'
      },
      {
        name: 'Piquage de Carrelage et Chape Ancienne',
        description: 'Évacuation au marteau perforateur jusqu’à retrouver la dalle béton d’origine.',
        specs: 'Prépare le support pour un nouveau ragréage propre.'
      }
    ],
    executionSteps: [
      '1. Vérification formelle auprès du bureau d’études : aucun mur porteur ni poteau concerné.',
      '2. Coupure générale des alimentations d’eau, de gaz et d’électricité de la zone.',
      '3. Bâchage de protection des accès, portes et ascenseurs.',
      '4. Abattage méthodique de haut en bas pour éviter l’effondrement brutal.',
      '5. Ensachage en sacs à gravats renforcés et chargement par camionnette/camion.'
    ],
    dimensionsTable: [
      { element: 'Volume Gravats Cloison Brique 12cm', standard: '0.15 m³ de gravats foisonnés par m²', notes: 'Facteur de foisonnement x 1.4' },
      { element: 'Capacité Camionnette Standard', standard: '2 à 3 m³ (environ 2.5 à 3.5 tonnes)', notes: 'Chantier urbain accessible' },
      { element: 'Capacité Camion Benne 6 Roues', standard: '6 à 8 m³ (environ 8 à 10 tonnes)', notes: 'Gros chantier de rénovation' }
    ],
    formulas: [
      'Volume Gravats Foisonnés m³ = Surface Démolie m² x Épaisseur x 1.40',
      'Nombre de Camions (6m³) = Volume Gravats m³ / 6.0 m³'
    ],
    variables: [
      '[STANDARD]: Démolition de cloisons de distribution non structurelles',
      '[INTERDIT]: Aucune intervention sur éléments porteurs (poteaux, poutres, voiles)'
    ],
    tips: [
      'Arrosez légèrement les gravats avec un pulvérisateur d’eau pendant la démolition pour abattre la poussière volatile et protéger les ouvriers.'
    ]
  }
];
